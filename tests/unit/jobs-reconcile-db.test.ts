import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole, type OrganizationRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { listDeadLetters, reprocessDeadLetter } from "@/lib/jobs/dead-letter";
import { enqueueJob } from "@/lib/jobs/outbox";
import { reclaimExpiredLeases } from "@/lib/jobs/reconcile";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

describeLocalDatabase("a consumer that never came home", () => {
  let fx: QueueFixture;

  beforeAll(async () => {
    fx = await createQueueFixture();
  });

  afterAll(async () => {
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  async function seed(overrides: Record<string, unknown> = {}) {
    return prisma.job.create({
      data: {
        organizationId: fx.organizationId,
        generationRunId: fx.generationRunId,
        kind: "generation.poll",
        idempotencyKey: `teste:${Math.random().toString(36).slice(2)}`,
        payloadJson: "{}",
        ...overrides,
      },
    });
  }

  it("brings the job back and leaves both counters exactly where they were", async () => {
    // A dead consumer is not a failed job: nothing was tried and refused, the
    // process simply stopped existing. Spending an attempt here would let four
    // deploys during a long generation kill a healthy run.
    const stuck = await seed({
      status: "EM_EXECUCAO",
      leaseOwner: "consumidor-morto",
      leaseExpiresAt: new Date(Date.now() - 1_000),
      attempts: 3,
      pollCount: 17,
    });

    const reclaimed = await reclaimExpiredLeases();

    expect(reclaimed.map((job) => job.id)).toContain(stuck.id);
    const back = await prisma.job.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(back.status).toBe("PENDENTE");
    expect(back.attempts).toBe(3);
    expect(back.pollCount).toBe(17);
    expect(back.leaseOwner).toBeNull();
    expect(back.leaseExpiresAt).toBeNull();
  });

  it("does not move the time it was already due", async () => {
    const due = new Date(Date.now() - 120_000);
    const stuck = await seed({
      status: "EM_EXECUCAO",
      leaseOwner: "consumidor-morto",
      leaseExpiresAt: new Date(Date.now() - 1_000),
      runAfter: due,
    });

    await reclaimExpiredLeases();

    const back = await prisma.job.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(back.runAfter.getTime()).toBe(due.getTime());
  });

  it("leaves a job whose consumer is still alive", async () => {
    const alive = await seed({
      status: "EM_EXECUCAO",
      leaseOwner: "consumidor-vivo",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const reclaimed = await reclaimExpiredLeases();

    expect(reclaimed.map((job) => job.id)).not.toContain(alive.id);
    const untouched = await prisma.job.findUniqueOrThrow({ where: { id: alive.id } });
    expect(untouched.leaseOwner).toBe("consumidor-vivo");
  });

  it.each(["PENDENTE", "PAUSADO", "CONCILIACAO", "CONCLUIDO", "FALHOU", "CARTA_MORTA"])(
    "never touches a job in %s",
    async (status) => {
      const other = await seed({
        status,
        leaseOwner: "consumidor-morto",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      });

      const reclaimed = await reclaimExpiredLeases();

      expect(reclaimed.map((job) => job.id)).not.toContain(other.id);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(status);
    },
  );

  it("makes the job claimable again, by anyone", async () => {
    await seed({
      status: "EM_EXECUCAO",
      leaseOwner: "consumidor-morto",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    await reclaimExpiredLeases();

    const claimed = await claimJob({ owner: "consumidor-novo" });
    expect(claimed!.leaseOwner).toBe("consumidor-novo");
  });
});

function actorWith(role: OrganizationRole, fx: QueueFixture, userId: string): Actor {
  return {
    userId,
    email: "operador@example.test",
    name: "Operador",
    organizationId: fx.organizationId,
    organizationSlug: "fila",
    organizationName: "Fila",
    membershipId: "m-1",
    role,
    permissions: permissionsForRole(role),
  };
}

describeLocalDatabase("the dead letter, and the one way out of it", () => {
  let fx: QueueFixture;
  let userId: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const user = await prisma.user.create({
      data: {
        email: `fila-${fx.token}@example.test`,
        name: "Operador",
        passwordHash: "nao-usado-por-este-teste",
        role: "operator",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  async function deadLetter() {
    const job = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
        },
        payload: { generationRunId: fx.generationRunId },
        siteProjectId: fx.siteProjectId,
        generationRunId: fx.generationRunId,
      }),
    );
    return prisma.job.update({
      where: { id: job.id },
      data: {
        status: "CARTA_MORTA",
        attempts: 5,
        pollCount: 4,
        finishedAt: new Date(),
        lastError: "mensagem segura",
        lastErrorCode: "ERRO_INESPERADO",
        correlationId: "11111111-1111-1111-1111-111111111111",
      },
    });
  }

  it("puts the job back with a clean slate", async () => {
    const dead = await deadLetter();

    const revived = await reprocessDeadLetter(actorWith("ADMIN", fx, userId), dead.id);

    expect(revived.status).toBe("PENDENTE");
    expect(revived.attempts).toBe(0);
    expect(revived.pollCount).toBe(0);
    expect(revived.finishedAt).toBeNull();
    expect(revived.lastError).toBeNull();
    expect(revived.lastErrorCode).toBeNull();
    expect(revived.correlationId).toBeNull();
  });

  it("demands `job:run`, which reading does not grant", async () => {
    const dead = await deadLetter();

    // Reprocessing can restart paid work. Seeing the queue is not deciding to
    // run it again.
    await expect(
      reprocessDeadLetter(actorWith("OPERADOR", fx, userId), dead.id),
    ).rejects.toMatchObject({ permission: "job:run", status: 403 });

    expect((await prisma.job.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe(
      "CARTA_MORTA",
    );
  });

  it("lets an operator read the dead letters", async () => {
    const dead = await deadLetter();

    const listed = await listDeadLetters(actorWith("OPERADOR", fx, userId));
    expect(listed.map((job) => job.id)).toEqual([dead.id]);

    await expect(listDeadLetters(actorWith("LEITOR", fx, userId))).rejects.toMatchObject({
      permission: "job:read",
    });
  });

  it("records who revived it, in the same transaction", async () => {
    const dead = await deadLetter();

    await reprocessDeadLetter(actorWith("ADMIN", fx, userId), dead.id);

    const audits = await prisma.auditLog.findMany({ where: { userId } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("job.reprocessado");
    expect(audits[0]!.entityId).toBe(dead.id);
    // The closed code travels; the message does not.
    expect(audits[0]!.metaJson).toContain("ERRO_INESPERADO");
    expect(audits[0]!.metaJson).not.toContain("mensagem segura");
  });

  it("writes no audit entry when the revival is refused", async () => {
    const dead = await deadLetter();
    await prisma.job.update({ where: { id: dead.id }, data: { status: "PENDENTE" } });

    await expect(
      reprocessDeadLetter(actorWith("ADMIN", fx, userId), dead.id),
    ).rejects.toMatchObject({ code: "JOB_NAO_REPROCESSAVEL" });

    expect(await prisma.auditLog.count({ where: { userId } })).toBe(0);
  });

  it("does not breach the exclusion of a live job", async () => {
    // Reprocessing a start while another is live for the same project would
    // begin a second paid generation — and the operator has no way of knowing
    // that from the dead letter screen.
    const dead = await deadLetter();

    const brief = await prisma.siteBriefVersion.findFirstOrThrow({
      where: { siteProjectId: fx.siteProjectId },
    });
    const otherRun = await prisma.generationRun.create({
      data: {
        siteProjectId: fx.siteProjectId,
        briefVersionId: brief.id,
        provider: "manual",
        requestJson: "{}",
      },
    });
    await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: otherRun.id,
          siteProjectId: fx.siteProjectId,
        },
        payload: { generationRunId: otherRun.id },
        siteProjectId: fx.siteProjectId,
        generationRunId: otherRun.id,
      }),
    );

    await expect(
      reprocessDeadLetter(actorWith("ADMIN", fx, userId), dead.id),
    ).rejects.toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });

    expect((await prisma.job.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe(
      "CARTA_MORTA",
    );
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(0);
  });

  it("refuses a job of another organization the same way it refuses a missing one", async () => {
    const dead = await deadLetter();
    const foreign = actorWith("ADMIN", { ...fx, organizationId: fx.otherOrganizationId }, userId);

    await expect(reprocessDeadLetter(foreign, dead.id)).rejects.toMatchObject({
      code: "JOB_NAO_REPROCESSAVEL",
    });
    await expect(reprocessDeadLetter(foreign, "nao-existe")).rejects.toMatchObject({
      code: "JOB_NAO_REPROCESSAVEL",
    });
  });
});

describe("the queue permissions land where they should", () => {
  it("lets an operator watch and an admin decide", () => {
    expect(permissionsForRole("LEITOR")).not.toContain("job:read");
    expect(permissionsForRole("OPERADOR")).toContain("job:read");
    expect(permissionsForRole("OPERADOR")).not.toContain("job:run");
    expect(permissionsForRole("ADMIN")).toContain("job:run");
    expect(permissionsForRole("OWNER")).toContain("job:run");
  });
});
