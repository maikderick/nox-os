import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { reprocessDeadLetter } from "@/lib/jobs/dead-letter";
import { enqueueJob } from "@/lib/jobs/outbox";
import { MAX_LEASE_RECOVERIES, reclaimExpiredLeases } from "@/lib/jobs/reconcile";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

/**
 * The gap this closes: "the platform died" and "this job kills whatever runs
 * it" produce exactly the same row — `EM_EXECUCAO`, lease lapsed, nobody home.
 * Only repetition tells them apart, and until now nothing counted the
 * repetition, so a job that took a consumer down came back to take the next one
 * down too, indefinitely.
 */
describeLocalDatabase("a job that keeps killing its consumer", () => {
  let fx: QueueFixture;
  let actor: Actor;
  let userId: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const user = await prisma.user.create({
      data: {
        email: `resgate-${fx.token}@example.test`,
        name: "Operador",
        passwordHash: "nao-usado-por-este-teste",
        role: "admin",
      },
    });
    userId = user.id;
    actor = {
      userId: user.id,
      email: user.email,
      name: "Operador",
      organizationId: fx.organizationId,
      organizationSlug: "fila",
      organizationName: "Fila",
      membershipId: "m-1",
      role: "ADMIN",
      permissions: permissionsForRole("ADMIN"),
    };
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

  async function queued() {
    return prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
      }),
    );
  }

  /** A consumer takes the job and dies without ever settling it. */
  async function claimAndDie(owner: string) {
    const claimed = await claimJob({ owner });
    await prisma.job.update({
      where: { id: claimed!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    return claimed!;
  }

  it("counts each rescue without touching the other two counters", async () => {
    const job = await queued();
    await prisma.job.update({ where: { id: job.id }, data: { attempts: 2, pollCount: 11 } });

    await claimAndDie("consumidor-1");
    const [first] = await reclaimExpiredLeases();

    expect(first!.leaseRecoveryCount).toBe(1);
    expect(first!.status).toBe("PENDENTE");
    // A dead consumer is not a failed job, and not a wasted poll either.
    expect(first!.attempts).toBe(2);
    expect(first!.pollCount).toBe(11);
  });

  it("gives up on the third rescue and hands the job to a person", async () => {
    const job = await queued();

    for (let rescue = 1; rescue <= MAX_LEASE_RECOVERIES; rescue += 1) {
      await claimAndDie(`consumidor-${rescue}`);
      const [reclaimed] = await reclaimExpiredLeases();

      expect(reclaimed!.leaseRecoveryCount).toBe(rescue);
      if (rescue < MAX_LEASE_RECOVERIES) {
        expect(reclaimed!.status).toBe("PENDENTE");
        expect(reclaimed!.lastErrorCode).toBeNull();
      } else {
        // Three consumers dying on the same job is a pattern, not bad luck.
        expect(reclaimed!.status).toBe("CONCILIACAO");
        expect(reclaimed!.lastErrorCode).toBe("RESGATES_SUCESSIVOS");
        expect(reclaimed!.attempts).toBe(0);
        expect(reclaimed!.pollCount).toBe(0);
      }
    }

    // And it stops circulating: nothing acquires a job in conciliation.
    expect(await claimJob({ owner: "consumidor-4" })).toBeNull();
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "CONCILIACAO",
    });
  });

  it("writes a rebuilt message, never a copied one", async () => {
    const job = await queued();
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseRecoveryCount: MAX_LEASE_RECOVERIES - 1 },
    });

    await claimAndDie("consumidor-1");
    const [reclaimed] = await reclaimExpiredLeases();

    expect(reclaimed!.lastError).toContain("conciliação");
    expect(reclaimed!.lastError).toContain("derruba quem o executa");
    // Nothing unknown travelled with it: no correlation id, because there was
    // no original error to withhold.
    expect(reclaimed!.correlationId).toBeNull();
  });

  it("leaves the recorded failure alone on an ordinary rescue", async () => {
    const job = await queued();
    await prisma.job.update({
      where: { id: job.id },
      data: { lastError: "falha anterior", lastErrorCode: "PAYLOAD_INVALIDO" },
    });

    await claimAndDie("consumidor-1");
    const [reclaimed] = await reclaimExpiredLeases();

    expect(reclaimed!.status).toBe("PENDENTE");
    expect(reclaimed!.lastErrorCode).toBe("PAYLOAD_INVALIDO");
    expect(reclaimed!.lastError).toBe("falha anterior");
  });

  it("counts each job on its own", async () => {
    const first = await queued();
    const second = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: {
          kind: "checks.poll",
          generationRunId: fx.generationRunId,
          commitSha: "0123456789abcdef0123456789abcdef01234567",
        },
      }),
    );

    await prisma.job.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: {
        status: "EM_EXECUCAO",
        leaseOwner: "consumidor-morto",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });
    await prisma.job.update({ where: { id: second.id }, data: { leaseRecoveryCount: 2 } });

    const reclaimed = await reclaimExpiredLeases();
    const byId = new Map(reclaimed.map((job) => [job.id, job]));

    expect(byId.get(first.id)!.status).toBe("PENDENTE");
    expect(byId.get(first.id)!.leaseRecoveryCount).toBe(1);
    expect(byId.get(second.id)!.status).toBe("CONCILIACAO");
    expect(byId.get(second.id)!.leaseRecoveryCount).toBe(3);
  });

  describe("a person putting it back", () => {
    it("clears the recovery count along with the rest", async () => {
      const job = await queued();
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "CARTA_MORTA", attempts: 5, leaseRecoveryCount: 2, finishedAt: new Date() },
      });

      const revived = await reprocessDeadLetter(actor, job.id);

      // Otherwise a reprocessed job would arrive with one rescue left, and the
      // next ordinary deploy would send it straight to conciliation.
      expect(revived.leaseRecoveryCount).toBe(0);
      expect(revived.attempts).toBe(0);
    });
  });
});
