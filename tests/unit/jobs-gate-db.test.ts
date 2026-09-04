import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { runJobBatch } from "@/lib/jobs/consumer";
import { checkJobGate, PAUSE_RETRY_SECONDS, PROVIDER_BY_KIND } from "@/lib/jobs/gate";
import type { JobHandlers } from "@/lib/jobs/handlers";
import { JOB_KINDS } from "@/lib/jobs/kinds";
import { enqueueJob } from "@/lib/jobs/outbox";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("which provider each kind needs", () => {
  it("names every kind, so a new one cannot be forgotten", () => {
    expect(Object.keys(PROVIDER_BY_KIND).sort()).toEqual([...JOB_KINDS].sort());
  });

  it("leaves the credit threshold outside the brake", () => {
    // Money and clocks, both ours. Releasing reservations and watching
    // deadlines is exactly the work an installation with its integrations off
    // still needs done.
    expect(PROVIDER_BY_KIND["credit.threshold"]).toBeNull();
  });
});

describeLocalDatabase("the brake, and the resume that is its pair", () => {
  let fx: QueueFixture;
  const originalBrake = process.env.NOX_INTEGRATIONS;

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
    await prisma.integrationSetting.deleteMany({ where: { organizationId: fx.organizationId } });
    delete process.env.NOX_INTEGRATIONS;
  });

  afterEach(() => {
    if (originalBrake === undefined) delete process.env.NOX_INTEGRATIONS;
    else process.env.NOX_INTEGRATIONS = originalBrake;
  });

  function brakeOn() {
    process.env.NOX_INTEGRATIONS = "disabled";
  }

  async function providerOn(provider: string, mode = "FALSO") {
    await prisma.integrationSetting.upsert({
      where: { organizationId_provider: { organizationId: fx.organizationId, provider } },
      create: { organizationId: fx.organizationId, provider, mode },
      update: { mode },
    });
  }

  /** A `checks.poll`, which depends on GitHub. */
  async function queueObserver() {
    return prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
      }),
    );
  }

  const ran: string[] = [];
  const completing: JobHandlers = {
    "checks.poll": async (context) => {
      ran.push(context.job.id);
      return { type: "concluido" };
    },
    "credit.threshold": async (context) => {
      ran.push(context.job.id);
      return { type: "concluido" };
    },
  };

  beforeEach(() => {
    ran.length = 0;
  });

  describe("with the brake on", () => {
    it("pauses without punishing anything", async () => {
      const job = await queueObserver();
      brakeOn();

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.outcomes).toEqual({ pausar: 1 });
      expect(ran).toEqual([]);

      const paused = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(paused.status).toBe("PAUSADO");
      expect(paused.pausedReason).toBe("FREIO_GLOBAL");
      // Nothing was refused, so nothing is charged: no attempt, no wait, no
      // error text, and no backoff.
      expect(paused.attempts).toBe(0);
      expect(paused.pollCount).toBe(0);
      expect(paused.lastError).toBeNull();
      expect(paused.lastErrorCode).toBeNull();
      expect(paused.runAfter.getTime()).toBeGreaterThan(
        Date.now() + (PAUSE_RETRY_SECONDS - 30) * 1000,
      );
    });

    it("keeps running jobs that need no provider", async () => {
      const semProvedor = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "credit.threshold", reservationId: "reserva-1" },
        }),
      );
      const comProvedor = await queueObserver();
      brakeOn();

      const report = await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.outcomes).toEqual({ concluido: 1, pausar: 1 });
      expect(ran).toEqual([semProvedor.id]);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: comProvedor.id } })).status).toBe(
        "PAUSADO",
      );
      expect((await prisma.job.findUniqueOrThrow({ where: { id: semProvedor.id } })).status).toBe(
        "CONCLUIDO",
      );
    });

    it("survives a thousand cycles without a single dead letter", async () => {
      // The brake being on for a fortnight has to leave the queue exactly as it
      // found it. If pausing spent an attempt, five cycles would kill the job;
      // at a thousand there would be nothing left alive to resume.
      const job = await queueObserver();
      brakeOn();

      for (let cycle = 0; cycle < 1000; cycle += 1) {
        // Each cycle is a cron minute later, so the paused job is due again.
        await prisma.job.update({
          where: { id: job.id },
          data: { runAfter: new Date(Date.now() - 1_000) },
        });
        await runJobBatch({
          owner: `consumidor-${cycle}`,
          organizationId: fx.organizationId,
          handlers: completing,
        });
      }

      const stillThere = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(stillThere.status).toBe("PAUSADO");
      expect(stillThere.attempts).toBe(0);
      expect(stillThere.pollCount).toBe(0);
      expect(stillThere.leaseRecoveryCount).toBe(0);
      expect(
        await prisma.job.count({
          where: { organizationId: fx.organizationId, status: "CARTA_MORTA" },
        }),
      ).toBe(0);
    });
  });

  describe("the resume", () => {
    it("runs on the very next cycle once the brake comes off", async () => {
      const job = await queueObserver();
      brakeOn();
      await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PAUSADO");

      // The brake comes off, and the job's own `runAfter` comes due.
      delete process.env.NOX_INTEGRATIONS;
      await providerOn("github");
      await prisma.job.update({
        where: { id: job.id },
        data: { runAfter: new Date(Date.now() - 1_000) },
      });

      const report = await runJobBatch({
        owner: "consumidor-b",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      expect(report.outcomes).toEqual({ concluido: 1 });
      expect(ran).toEqual([job.id]);
      // There is no separate reconciler and no forgotten job: the pause carries
      // its own wake-up time.
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        "CONCLUIDO",
      );
    });

    it("pauses again, unpunished, if the brake is still on", async () => {
      const job = await queueObserver();
      brakeOn();

      for (let cycle = 0; cycle < 3; cycle += 1) {
        await prisma.job.update({
          where: { id: job.id },
          data: { runAfter: new Date(Date.now() - 1_000) },
        });
        await runJobBatch({
          owner: `consumidor-${cycle}`,
          organizationId: fx.organizationId,
          handlers: completing,
        });
      }

      const paused = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(paused.status).toBe("PAUSADO");
      expect(paused.attempts).toBe(0);
    });
  });

  describe("the pause reason does not outlive the pause", () => {
    it("is cleared the moment the job is acquired", async () => {
      const job = await queueObserver();
      brakeOn();
      await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      delete process.env.NOX_INTEGRATIONS;
      await providerOn("github");
      await prisma.job.update({
        where: { id: job.id },
        data: { runAfter: new Date(Date.now() - 1_000) },
      });

      const claimed = await claimJob({ owner: "consumidor-b" });
      expect(claimed!.id).toBe(job.id);
      expect(claimed!.status).toBe("EM_EXECUCAO");
      expect(claimed!.pausedReason).toBeNull();
    });

    it("does not attach an old brake to a later, unrelated failure", async () => {
      // The failure this prevents is a diagnostic one: an operator reading
      // `pausedReason = FREIO_GLOBAL` on a job that failed for a completely
      // different reason, days after the brake came off.
      const job = await queueObserver();
      brakeOn();
      await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).pausedReason).toBe(
        "FREIO_GLOBAL",
      );

      delete process.env.NOX_INTEGRATIONS;
      await providerOn("github");
      await prisma.job.update({
        where: { id: job.id },
        data: { runAfter: new Date(Date.now() - 1_000) },
      });

      await runJobBatch({
        owner: "consumidor-b",
        organizationId: fx.organizationId,
        handlers: {
          "checks.poll": async () => {
            throw new Error("nada a ver com o freio");
          },
        },
      });

      const failed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(failed.status).toBe("PENDENTE");
      expect(failed.attempts).toBe(1);
      expect(failed.lastErrorCode).toBe("ERRO_INESPERADO");
      expect(failed.pausedReason).toBeNull();
    });

    it("is cleared on completion too", async () => {
      const job = await queueObserver();
      brakeOn();
      await runJobBatch({
        owner: "consumidor-a",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      delete process.env.NOX_INTEGRATIONS;
      await providerOn("github");
      await prisma.job.update({
        where: { id: job.id },
        data: { runAfter: new Date(Date.now() - 1_000) },
      });
      await runJobBatch({
        owner: "consumidor-b",
        organizationId: fx.organizationId,
        handlers: completing,
      });

      const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(done.status).toBe("CONCLUIDO");
      expect(done.pausedReason).toBeNull();
    });
  });

  describe("the two refusals are told apart", () => {
    it("says `FREIO_GLOBAL` when the installation is braked", async () => {
      await providerOn("github");
      brakeOn();

      const verdict = await checkJobGate({
        kind: "checks.poll",
        organizationId: fx.organizationId,
      });

      expect(verdict).toEqual({ allowed: false, reason: "FREIO_GLOBAL" });
    });

    it("says `INTEGRACAO_DESLIGADA` when only this organization's provider is off", async () => {
      // They look identical in the queue and are fixed in completely different
      // places, so the paused job has to say which.
      await providerOn("github", "DESLIGADO");

      const verdict = await checkJobGate({
        kind: "checks.poll",
        organizationId: fx.organizationId,
      });

      expect(verdict).toEqual({ allowed: false, reason: "INTEGRACAO_DESLIGADA" });
    });

    it("refuses a provider that was never configured", async () => {
      const verdict = await checkJobGate({
        kind: "checks.poll",
        organizationId: fx.organizationId,
      });

      expect(verdict).toEqual({ allowed: false, reason: "INTEGRACAO_DESLIGADA" });
    });

    it("lets a configured provider through", async () => {
      await providerOn("vercel", "SANDBOX");

      expect(
        await checkJobGate({ kind: "preview.poll", organizationId: fx.organizationId }),
      ).toEqual({ allowed: true });
    });

    it("never asks about a kind that needs nobody", async () => {
      brakeOn();

      expect(
        await checkJobGate({ kind: "credit.threshold", organizationId: fx.organizationId }),
      ).toEqual({ allowed: true });
    });
  });
});
