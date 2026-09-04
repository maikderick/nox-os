import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { reprocessDeadLetter } from "@/lib/jobs/dead-letter";
import { POLL_DEADLINE_SECONDS } from "@/lib/jobs/deadlines";
import { deferJob, failJobRecoverable } from "@/lib/jobs/outcomes";
import { enqueueJob } from "@/lib/jobs/outbox";
import { JobRefusal } from "@/lib/jobs/reasons";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const HOUR = 60 * 60 * 1000;

/**
 * The queue keeps one clock, and it is not this one.
 *
 * Node and PostgreSQL agree only by luck. On a laptop the gap is milliseconds;
 * on a serverless instance whose host has drifted, or during an NTP step, it is
 * seconds or worse — and every one of those is enough to make a job that is due
 * look pending, or a job that is not due look ready.
 *
 * So the process clock is moved on purpose here, two hours each way. Nothing
 * about the queue's behaviour may change. Any assertion in this file that fails
 * is a `Date.now()` that crept back into a row.
 */
describeLocalDatabase("the queue's clock is the database's", () => {
  let fx: QueueFixture;
  let actor: Actor;
  let userId: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const user = await prisma.user.create({
      data: {
        email: `relogio-${fx.token}@example.test`,
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
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Only `Date` is faked; timers keep working, so the driver's pool is untouched. */
  function skewNodeClockBy(offsetMs: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + offsetMs));
  }

  async function databaseNow(): Promise<Date> {
    const [{ agora }] = await prisma.$queryRaw<Array<{ agora: Date }>>`SELECT NOW() AS "agora"`;
    return agora;
  }

  describe.each([
    ["duas horas adiantado", 2 * HOUR],
    ["duas horas atrasado", -2 * HOUR],
    ["um dia adiantado", 24 * HOUR],
  ])("with this process's clock %s", (_label, offset) => {
    it("enqueues a job that is due now, not in two hours", async () => {
      skewNodeClockBy(offset);

      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );

      vi.useRealTimers();
      const agora = await databaseNow();
      // Within a second of the database's own now — which is what "now" means.
      expect(Math.abs(job.runAfter.getTime() - agora.getTime())).toBeLessThan(1_000);
    });

    it("claims that job immediately", async () => {
      skewNodeClockBy(offset);

      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );
      const claimed = await claimJob({ owner: "consumidor-a" });

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("EM_EXECUCAO");
    });

    it("gives the lease a deadline measured from the database", async () => {
      skewNodeClockBy(offset);

      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );
      const claimed = await claimJob({ owner: "consumidor-a", leaseSeconds: 60 });

      vi.useRealTimers();
      const agora = await databaseNow();
      const remaining = claimed!.leaseExpiresAt!.getTime() - agora.getTime();
      expect(remaining).toBeGreaterThan(50_000);
      expect(remaining).toBeLessThan(70_000);
    });

    it("measures the patience budget from the database too", async () => {
      skewNodeClockBy(offset);

      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );

      vi.useRealTimers();
      const agora = await databaseNow();
      const budget = POLL_DEADLINE_SECONDS["generation.poll"]! * 1000;
      const remaining = job.pollDeadlineAt!.getTime() - agora.getTime();
      expect(remaining).toBeGreaterThan(budget - 5_000);
      expect(remaining).toBeLessThan(budget + 5_000);
    });

    it("defers by the delay asked for, from the database's now", async () => {
      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );
      const claimed = (await claimJob({ owner: "dono" }))!;

      skewNodeClockBy(offset);
      const deferred = await deferJob({ jobId: claimed.id, owner: "dono", delaySeconds: 45 });

      vi.useRealTimers();
      const agora = await databaseNow();
      const delay = deferred!.runAfter.getTime() - agora.getTime();
      expect(delay).toBeGreaterThan(40_000);
      expect(delay).toBeLessThan(50_000);
    });

    it("backs off from the database's now as well", async () => {
      await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );
      const claimed = (await claimJob({ owner: "dono" }))!;

      skewNodeClockBy(offset);
      const failed = await failJobRecoverable({
        jobId: claimed.id,
        owner: "dono",
        error: new JobRefusal("PAYLOAD_INVALIDO"),
        // Full jitter pinned to its ceiling, so the assertion is about the
        // origin of the instant and not about the draw.
        random: () => 0.999999,
      });

      vi.useRealTimers();
      const agora = await databaseNow();
      const delay = failed!.runAfter.getTime() - agora.getTime();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(35_000);
    });

    it("reprocesses a dead letter into a job that is due now", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "CARTA_MORTA", attempts: 5, finishedAt: new Date() },
      });

      skewNodeClockBy(offset);
      const revived = await reprocessDeadLetter(actor, job.id);
      const claimed = await claimJob({ owner: "consumidor-a" });

      vi.useRealTimers();
      const agora = await databaseNow();
      expect(Math.abs(revived.runAfter.getTime() - agora.getTime())).toBeLessThan(2_000);
      // The point of "due now": the very next consumer picks it up.
      expect(claimed?.id).toBe(job.id);
    });
  });

  it("still honours a `runAfter` the caller asked for explicitly", async () => {
    // The rule is "no implicit process clock", not "ignore the caller". A
    // scheduled instant is a decision, and it is kept.
    const quando = new Date((await databaseNow()).getTime() + 10 * 60 * 1000);

    const job = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        runAfter: quando,
      }),
    );

    expect(job.runAfter.getTime()).toBe(quando.getTime());
    expect(await claimJob({ owner: "consumidor-a" })).toBeNull();
  });
});
