import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { runJobBatch } from "@/lib/jobs/consumer";
import type { JobHandlers } from "@/lib/jobs/handlers";
import { enqueueJob } from "@/lib/jobs/outbox";
import { reclaimExpiredLeases } from "@/lib/jobs/reconcile";

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

      await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

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

  });

});
