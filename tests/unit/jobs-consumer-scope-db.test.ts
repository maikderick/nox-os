import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { runJobBatch } from "@/lib/jobs/consumer";
import type { JobHandlers } from "@/lib/jobs/handlers";
import { enqueueJob } from "@/lib/jobs/outbox";
import { MAX_LEASE_RECOVERIES, reclaimExpiredLeases } from "@/lib/jobs/reconcile";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * Whose queue a consumer is working.
 *
 * The scheduler has no organization because it serves all of them. A person
 * has exactly one, and a request from A must not run B's job: it would execute
 * under A's request, be recorded against A's operator, and spend A's function
 * budget on someone else's site.
 */
describeLocalDatabase("the consumer's scope", () => {
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

  /** One observer job in each organization. */
  async function queueBoth() {
    const a = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
      }),
    );
    const b = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.otherOrganizationId,
        step: { kind: "checks.poll", generationRunId: fx.otherGenerationRunId, commitSha: SHA },
      }),
    );
    return { a, b };
  }

  const completing: JobHandlers = {
    "checks.poll": async () => ({ type: "concluido" }),
  };

  describe("a tenant-scoped run", () => {
    it("works A's job and does not touch B's", async () => {
      const { a, b } = await queueBoth();

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.claimed).toBe(1);
      expect(report.organizationId).toBe(fx.organizationId);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONCLUIDO");

      const untouched = await prisma.job.findUniqueOrThrow({ where: { id: b.id } });
      expect(untouched.status).toBe("PENDENTE");
      expect(untouched.leaseOwner).toBeNull();
    });

    it("finds nothing when only the other organization has work", async () => {
      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.otherOrganizationId,
          step: { kind: "checks.poll", generationRunId: fx.otherGenerationRunId, commitSha: SHA },
        }),
      );

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.claimed).toBe(0);
      expect(report.stoppedBecause).toBe("sem_trabalho");
    });

    it("does not resurrect the other organization's stuck job", async () => {
      // A reclaim counts a recovery. Three requests from A would otherwise send
      // B's job to conciliation without B ever asking for anything.
      const { b } = await queueBoth();
      await prisma.job.update({
        where: { id: b.id },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-morto",
          leaseExpiresAt: new Date(Date.now() - 1_000),
        },
      });

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.reclaimed).toBe(0);
      const stillStuck = await prisma.job.findUniqueOrThrow({ where: { id: b.id } });
      expect(stillStuck.status).toBe("EM_EXECUCAO");
      expect(stillStuck.leaseRecoveryCount).toBe(0);
    });

    it("scopes the acquisition itself, not just the batch", async () => {
      await queueBoth();

      const claimed = await claimJob({ owner: "consumidor-a", organizationId: fx.organizationId });

      expect(claimed!.organizationId).toBe(fx.organizationId);
    });

    it("scopes the reclaim itself, not just the batch", async () => {
      const { a, b } = await queueBoth();
      await prisma.job.updateMany({
        where: { id: { in: [a.id, b.id] } },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-morto",
          leaseExpiresAt: new Date(Date.now() - 1_000),
        },
      });

      const reclaimed = await reclaimExpiredLeases({ organizationId: fx.organizationId });

      expect(reclaimed.map((job) => job.id)).toEqual([a.id]);
    });
  });

  describe("the global run", () => {
    it("works both organizations in one pass", async () => {
      const { a, b } = await queueBoth();

      const report = await runJobBatch({ owner: "agendador", handlers: completing });

      expect(report.claimed).toBe(2);
      expect(report.organizationId).toBeUndefined();
      expect((await prisma.job.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONCLUIDO");
      expect((await prisma.job.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONCLUIDO");
    });

    it("reclaims stuck jobs of both", async () => {
      const { a, b } = await queueBoth();
      await prisma.job.updateMany({
        where: { id: { in: [a.id, b.id] } },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-morto",
          leaseExpiresAt: new Date(Date.now() - 1_000),
        },
      });

      const report = await runJobBatch({ owner: "agendador", handlers: completing });

      expect(report.reclaimed).toBe(2);
      expect(report.claimed).toBe(2);
    });
  });

  describe("the reclaim happens inside the run", () => {
    it("brings back an expired job and processes it, with no manual call", async () => {
      // The point of doing it here: a job whose consumer was killed is
      // invisible to `claimJob`. If reclaiming were a separate cron or a button
      // someone remembers, the queue would look stuck for a reason nobody could
      // see from the queue itself.
      const { a } = await queueBoth();
      await prisma.job.update({
        where: { id: a.id },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-morto",
          leaseExpiresAt: new Date(Date.now() - 1_000),
          pollCount: 4,
        },
      });

      const report = await runJobBatch({
        owner: "consumidor-vivo",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.reclaimed).toBe(1);
      expect(report.claimed).toBe(1);
      expect(report.outcomes).toEqual({ concluido: 1 });

      const done = await prisma.job.findUniqueOrThrow({ where: { id: a.id } });
      expect(done.status).toBe("CONCLUIDO");
      expect(done.leaseRecoveryCount).toBe(1);
      // The rescue costs a recovery and nothing else.
      expect(done.attempts).toBe(0);
      expect(done.pollCount).toBe(4);
    });

    it("does not rescue a job whose consumer is still alive", async () => {
      const { a } = await queueBoth();
      await prisma.job.update({
        where: { id: a.id },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-vivo",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      const report = await runJobBatch({
        owner: "outro-consumidor",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.reclaimed).toBe(0);
      expect(report.claimed).toBe(0);
    });

    it("stops rescuing at the cap, inside the run like anywhere else", async () => {
      const { a } = await queueBoth();
      await prisma.job.update({
        where: { id: a.id },
        data: {
          status: "EM_EXECUCAO",
          leaseOwner: "consumidor-morto",
          leaseExpiresAt: new Date(Date.now() - 1_000),
          leaseRecoveryCount: MAX_LEASE_RECOVERIES - 1,
        },
      });

      const report = await runJobBatch({
        owner: "consumidor-vivo",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.reclaimed).toBe(1);
      // Reclaimed straight into conciliation, so there is nothing to acquire.
      expect(report.claimed).toBe(0);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
        "CONCILIACAO",
      );
    });
  });

  describe("losing the lease is not an outcome", () => {
    it("reports `lease_perdido` instead of the completion the handler asked for", async () => {
      // The handler said "done". It was not done: the job had already been
      // taken away, `completeJob` matched nothing, and the row is back in the
      // queue. Recording a completion here would put one in the log for a job
      // someone else is about to run.
      const { a } = await queueBoth();

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        budgetMs: 60_000,
        // One pass only: the loop would otherwise re-claim the same job.
        elapsedMs: (() => {
          let calls = 0;
          return () => (calls++ === 0 ? 0 : 60_000);
        })(),
        handlers: {
          "checks.poll": async (context) => {
            await prisma.job.update({
              where: { id: context.job.id },
              data: { leaseOwner: "outro-consumidor" },
            });
            return { type: "concluido" };
          },
        },
      });

      expect(report.claimed).toBe(1);
      expect(report.outcomes).toEqual({ lease_perdido: 1 });
      expect(report.outcomes.concluido).toBeUndefined();

      const job = await prisma.job.findUniqueOrThrow({ where: { id: a.id } });
      expect(job.status).toBe("EM_EXECUCAO");
      expect(job.leaseOwner).toBe("outro-consumidor");
    });

    it("reports it for a failure that could not be written either", async () => {
      await queueBoth();

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        budgetMs: 60_000,
        elapsedMs: (() => {
          let calls = 0;
          return () => (calls++ === 0 ? 0 : 60_000);
        })(),
        handlers: {
          "checks.poll": async (context) => {
            await prisma.job.update({
              where: { id: context.job.id },
              data: { leaseOwner: "outro-consumidor" },
            });
            throw new Error("falhou depois de perder o lease");
          },
        },
      });

      expect(report.outcomes).toEqual({ lease_perdido: 1 });
    });
  });
});
