import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { POLL_DEADLINE_SECONDS } from "@/lib/jobs/deadlines";
import { reprocessDeadLetter } from "@/lib/jobs/dead-letter";
import { JOB_KINDS, type JobKind } from "@/lib/jobs/kinds";
import { enqueueJob } from "@/lib/jobs/outbox";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describeLocalDatabase("reprocessing is one decision, not two", () => {
  let fx: QueueFixture;
  let actor: Actor;
  let userId: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const user = await prisma.user.create({
      data: {
        email: `reproc-${fx.token}@example.test`,
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

  async function deadPollJob(overrides: Record<string, unknown> = {}) {
    const job = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
      }),
    );
    return prisma.job.update({
      where: { id: job.id },
      data: {
        status: "CARTA_MORTA",
        attempts: 5,
        pollCount: 40,
        finishedAt: new Date(),
        lastError: "mensagem segura",
        lastErrorCode: "ERRO_INESPERADO",
        ...overrides,
      },
    });
  }

  describe("two operators clicking at once", () => {
    it("produces one revival, one audit entry, and one plain refusal", async () => {
      const dead = await deadPollJob();

      const [first, second] = await Promise.allSettled([
        reprocessDeadLetter(actor, dead.id),
        reprocessDeadLetter(actor, dead.id),
      ]);

      const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
      const rejected = [first, second].filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "JOB_NAO_REPROCESSAVEL",
      });

      // The loser's whole transaction rolled back, so its audit went with it.
      expect(await prisma.auditLog.count({ where: { userId } })).toBe(1);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe(
        "PENDENTE",
      );
    });

    it("holds under more than two", async () => {
      const dead = await deadPollJob();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => reprocessDeadLetter(actor, dead.id)),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { userId } })).toBe(1);
    });
  });

  describe("what the reset actually resets", () => {
    it("zeroes the counters and clears the recorded failure", async () => {
      const dead = await deadPollJob();

      const revived = await reprocessDeadLetter(actor, dead.id);

      expect(revived.attempts).toBe(0);
      expect(revived.pollCount).toBe(0);
      expect(revived.finishedAt).toBeNull();
      expect(revived.lastError).toBeNull();
      expect(revived.lastErrorCode).toBeNull();
      expect(revived.pausedReason).toBeNull();
    });

    it("renews the patience budget instead of preserving or clearing it", async () => {
      // Preserving it would restart a poll whose deadline blew months ago —
      // it would give up on the first look. Clearing it would hand the job
      // unlimited patience. Neither is what "reprocess" means.
      const expired = new Date(Date.now() - 90 * 60 * 1000);
      const dead = await deadPollJob({ pollDeadlineAt: expired });

      const revived = await reprocessDeadLetter(actor, dead.id);

      const budget = POLL_DEADLINE_SECONDS["generation.poll"]!;
      expect(revived.pollDeadlineAt).not.toBeNull();
      expect(revived.pollDeadlineAt!.getTime()).toBeGreaterThan(Date.now() + budget * 1000 * 0.9);
      expect(revived.pollDeadlineAt!.getTime()).toBeLessThan(Date.now() + budget * 1000 * 1.1);
    });

    it("leaves a kind that never waits without a deadline", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: fx.generationRunId,
            siteProjectId: fx.siteProjectId,
          },
        }),
      );
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "CARTA_MORTA", pollDeadlineAt: new Date() },
      });

      const revived = await reprocessDeadLetter(actor, job.id);
      expect(revived.pollDeadlineAt).toBeNull();
    });
  });

  describe("the deadline policy is closed", () => {
    it("names every kind, so a new one cannot be forgotten", () => {
      expect(Object.keys(POLL_DEADLINE_SECONDS).sort()).toEqual([...JOB_KINDS].sort());
    });

    it.each([
      ["generation.poll", 2 * 60 * 60],
      ["checks.poll", 30 * 60],
      ["preview.poll", 30 * 60],
    ] as Array<[JobKind, number]>)("gives %s the budget the plan fixed", (kind, seconds) => {
      expect(POLL_DEADLINE_SECONDS[kind]).toBe(seconds);
    });

    it("applies the policy when a job is first enqueued too", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        }),
      );

      const budget = POLL_DEADLINE_SECONDS["checks.poll"]!;
      expect(job.pollDeadlineAt!.getTime()).toBeGreaterThan(Date.now() + budget * 1000 * 0.9);
    });

    it("lets a caller say `null` on purpose", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "preview.poll", generationRunId: fx.generationRunId, commitSha: SHA },
          pollDeadlineAt: null,
        }),
      );

      expect(job.pollDeadlineAt).toBeNull();
    });
  });
});
