import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { DEFAULT_LEASE_SECONDS } from "@/lib/jobs/claim";
import { runJobBatch } from "@/lib/jobs/consumer";
import type { JobHandlers, JobOutcome } from "@/lib/jobs/handlers";
import { enqueueJob } from "@/lib/jobs/outbox";
import { MAX_LEASE_RECOVERIES, reclaimExpiredLeases } from "@/lib/jobs/reconcile";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const MAX_DURATION_SECONDS = 300;

describe("the lease outlives the function that holds it", () => {
  it("is longer than the platform ceiling, not equal to it", () => {
    // Equal would mean a consumer still working at second 299 has its job
    // reclaimed in that same instant, and two consumers then call the same
    // provider — the duplicate the lease exists to prevent, produced by the
    // lease itself.
    expect(DEFAULT_LEASE_SECONDS).toBeGreaterThan(MAX_DURATION_SECONDS);
  });
});

describeLocalDatabase("the consumer, one job at a time", () => {
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

  /** Distinct steps, so all of them coexist in the queue. */
  async function queue(howMany: number) {
    const shas = Array.from({ length: howMany }, (_, i) =>
      i.toString(16).padStart(40, "a").slice(0, 40),
    );
    for (const commitSha of shas) {
      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha },
        }),
      );
    }
  }

  function handlersReturning(outcome: JobOutcome, seen?: string[]): JobHandlers {
    return {
      "checks.poll": async (context) => {
        seen?.push(context.job.id);
        return outcome;
      },
    };
  }

  it("works through everything it can and settles each one", async () => {
    await queue(3);
    const seen: string[] = [];

    const report = await runJobBatch({
      owner: "consumidor-a",
      handlers: handlersReturning({ type: "concluido" }, seen),
    });

    expect(report.claimed).toBe(3);
    expect(seen).toHaveLength(3);
    expect(report.outcomes).toEqual({ concluido: 3 });
    expect(report.stoppedBecause).toBe("sem_trabalho");

    const statuses = await prisma.job.findMany({
      where: { organizationId: fx.organizationId },
      select: { status: true, leaseOwner: true },
    });
    expect(statuses.every((job) => job.status === "CONCLUIDO")).toBe(true);
    expect(statuses.every((job) => job.leaseOwner === null)).toBe(true);
  });

  it("returns immediately when there is nothing to do", async () => {
    const report = await runJobBatch({ owner: "consumidor-a", handlers: {} });

    expect(report.claimed).toBe(0);
    expect(report.stoppedBecause).toBe("sem_trabalho");
  });

  describe("the budget", () => {
    it("stops after what it has time for, leaving the rest claimable and unleased", async () => {
      await queue(5);
      // Each job costs half the budget, so there is room for two.
      let elapsed = 0;
      const seen: string[] = [];

      const report = await runJobBatch({
        owner: "consumidor-a",
        budgetMs: 100_000,
        elapsedMs: () => elapsed,
        handlers: {
          "checks.poll": async (context) => {
            seen.push(context.job.id);
            elapsed += 50_000;
            return { type: "concluido" };
          },
        },
      });

      expect(report.claimed).toBe(2);
      expect(report.stoppedBecause).toBe("orcamento");

      // The three it did not run must be untouched: still due, and — this is
      // the part that matters — carrying no lease. Claiming a job it had no
      // time to run would park it for six minutes for nothing.
      const remaining = await prisma.job.findMany({
        where: { organizationId: fx.organizationId, status: "PENDENTE" },
      });
      expect(remaining).toHaveLength(3);
      expect(remaining.every((job) => job.leaseOwner === null)).toBe(true);
      expect(remaining.every((job) => job.leaseExpiresAt === null)).toBe(true);
      expect(remaining.every((job) => job.attempts === 0)).toBe(true);
    });

    it("claims nothing at all when the budget is already spent", async () => {
      await queue(2);

      const report = await runJobBatch({
        owner: "consumidor-a",
        budgetMs: 1_000,
        elapsedMs: () => 999_999,
        handlers: handlersReturning({ type: "concluido" }),
      });

      expect(report.claimed).toBe(0);
      expect(report.stoppedBecause).toBe("orcamento");
      expect(
        await prisma.job.count({ where: { organizationId: fx.organizationId, status: "PENDENTE" } }),
      ).toBe(2);
    });
  });

  describe("one bad job does not stop the queue", () => {
    it("settles the thrower and keeps going", async () => {
      await queue(3);
      let calls = 0;

      const report = await runJobBatch({
        owner: "consumidor-a",
        handlers: {
          "checks.poll": async () => {
            calls += 1;
            if (calls === 1) throw new Error("segredo ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
            return { type: "concluido" };
          },
        },
      });

      // Not an exact claim count. Full jitter draws from `[0, ceiling)`, and
      // the lower bound really is zero — a failed job can legitimately become
      // due again inside the same batch, roughly one run in thirty. Asserting
      // "three claims" was asserting the dice, so what is pinned instead is the
      // property the test is named after: the cycle did not stop at the thrower.
      expect(report.claimed).toBeGreaterThanOrEqual(3);
      expect(report.stoppedBecause).toBe("sem_trabalho");
      expect(report.outcomes.falha_recuperavel).toBe(1);
      expect(report.outcomes.concluido).toBe(report.claimed - 1);

      const failed = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId, attempts: { gt: 0 } },
      });
      expect(failed.attempts).toBe(1);
      // The thrown message never reaches the column, here as anywhere else.
      expect(failed.lastError).not.toContain("ghp_");
      expect(failed.lastErrorCode).toBe("ERRO_INESPERADO");
    });

    it("sends a kind nobody can run to conciliation rather than retrying it", async () => {
      // Repeating does not make code appear that does not exist.
      await queue(1);

      const report = await runJobBatch({ owner: "consumidor-a", handlers: {} });

      expect(report.outcomes).toEqual({ falha_permanente: 1 });
      const job = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(job.status).toBe("CONCILIACAO");
      expect(job.lastErrorCode).toBe("SEM_HANDLER");
      expect(job.attempts).toBe(0);
    });
  });

  describe("what a handler is handed", () => {
    it("gets the decoded payload, never the raw column", async () => {
      await queue(1);
      let received: unknown;

      await runJobBatch({
        owner: "consumidor-a",
        handlers: {
          "checks.poll": async (context) => {
            received = context.payload;
            return { type: "concluido" };
          },
        },
      });

      expect(received).toEqual({
        generationRunId: fx.generationRunId,
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0",
      });
    });

    it("can extend its own lease while it works", async () => {
      await queue(1);
      let beat: boolean | undefined;
      let mine: boolean | undefined;

      await runJobBatch({
        owner: "consumidor-a",
        leaseSeconds: 60,
        handlers: {
          "checks.poll": async (context) => {
            mine = await context.stillOurs();
            beat = await context.heartbeat();
            return { type: "concluido" };
          },
        },
      });

      expect(mine).toBe(true);
      expect(beat).toBe(true);
    });

    it("finds out it lost the job, and its outcome lands on nothing", async () => {
      // The one question a handler must ask before a remote call. A consumer
      // whose lease lapsed and that calls anyway produces the duplicate at the
      // most expensive possible moment.
      await queue(1);
      const answers: boolean[] = [];

      const report = await runJobBatch({
        owner: "consumidor-a",
        handlers: {
          "checks.poll": async (context) => {
            // Simulate the lease lapsing mid-handler and someone reclaiming.
            await prisma.job.update({
              where: { id: context.job.id },
              data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
            });
            await reclaimExpiredLeases();

            answers.push(await context.stillOurs());
            return { type: "concluido" };
          },
        },
      });

      expect(answers.every((mine) => mine === false)).toBe(true);

      // `completeJob` matches on the lease, so it wrote nothing — the job went
      // straight back to `PENDENTE` and this same batch claimed it again. That
      // loop is real, and what ends it is the recovery counter: on the third
      // rescue the job stops circulating and waits for a person.
      expect(report.claimed).toBe(MAX_LEASE_RECOVERIES);
      const job = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(job.status).toBe("CONCILIACAO");
      expect(job.lastErrorCode).toBe("RESGATES_SUCESSIVOS");
    });
  });

  describe("the other four outcomes reach the database", () => {
    it.each([
      [{ type: "aguardar", delaySeconds: 30 } as JobOutcome, "PENDENTE"],
      [
        { type: "pausar", reason: "FREIO_GLOBAL", retryAfterSeconds: 300 } as JobOutcome,
        "PAUSADO",
      ],
      [
        { type: "falha_permanente", error: new Error("x"), as: "CONCILIACAO" } as JobOutcome,
        "CONCILIACAO",
      ],
      [{ type: "falha_permanente", error: new Error("x") } as JobOutcome, "FALHOU"],
    ])("%o leaves the job in %s", async (outcome, expected) => {
      await queue(1);

      await runJobBatch({ owner: "consumidor-a", handlers: handlersReturning(outcome) });

      const job = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(job.status).toBe(expected);
      expect(job.leaseOwner).toBeNull();
    });
  });
});
