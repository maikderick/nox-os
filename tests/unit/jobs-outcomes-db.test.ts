import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { enqueueJob } from "@/lib/jobs/outbox";
import {
  completeJob,
  deferJob,
  failJobPermanent,
  failJobRecoverable,
  pauseJob,
} from "@/lib/jobs/outcomes";
import { JobRefusal } from "@/lib/jobs/reasons";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

/** Every secret shape phase 3 pinned, plus one nobody has seen yet. */
const LEAKS: Array<[string, string]> = [
  ["github fine-grained", "401 github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdef"],
  ["github classic", "bad credentials ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
  ["vercel", 'GET /v9/projects 403 {"token":"AbCdEf0123456789GhIjKlMnOpQr"}'],
  ["anthropic", "invalid x-api-key sk-ant-api03-AbCdEf-0123456789_GhIjKlMnOpQrStUvWxYz"],
  ["cookie", "set-cookie _vercel_jwt=eyJhbGciOi.eyJzdWIiOi.QWxhZGRpbjpvcGVu HttpOnly"],
  [
    "private key",
    "-----BEGIN RSA PRIVATE KEY----- MIIEowIBAAKCAQEA0Z3VS5JJcds3 -----END RSA PRIVATE KEY-----",
  ],
  ["formato desconhecido", "provider said <<<XYZ-9f3a::7712::segredo-de-formato-novo>>>"],
];

function fragments(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part.length > 12);
}

describeLocalDatabase("the five outcomes", () => {
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

  async function claimed(overrides: Record<string, unknown> = {}) {
    await prisma.job.create({
      data: {
        organizationId: fx.organizationId,
        generationRunId: fx.generationRunId,
        kind: "generation.poll",
        idempotencyKey: `teste:${Math.random().toString(36).slice(2)}`,
        payloadJson: "{}",
        ...overrides,
      },
    });
    return (await claimJob({ owner: "dono" }))!;
  }

  describe("waiting is not failing", () => {
    it("counts a hundred defers without spending a single attempt", async () => {
      // A generation that legitimately takes two hours is not a provider
      // refusing. Counting the wait would walk a healthy run into its dead
      // letter for the offence of taking two hours.
      let job = await claimed();

      for (let i = 0; i < 100; i += 1) {
        const deferred = await deferJob({ jobId: job.id, owner: "dono", delaySeconds: 0 });
        expect(deferred!.status).toBe("PENDENTE");
        job = (await claimJob({ owner: "dono" }))!;
      }

      const final = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(final.attempts).toBe(0);
      expect(final.pollCount).toBe(100);
    });

    it("pushes the next look into the future and lets the lease go", async () => {
      const job = await claimed();
      const deferred = await deferJob({ jobId: job.id, owner: "dono", delaySeconds: 90 });

      expect(deferred!.runAfter.getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect(deferred!.leaseOwner).toBeNull();
      expect(deferred!.leaseExpiresAt).toBeNull();
    });

    it("sends a blown deadline to conciliation, not to the dead letter", async () => {
      // A generation that ran out of patience may well have produced a remote
      // effect. A dead letter would quietly claim the opposite.
      const job = await claimed({ pollDeadlineAt: new Date(Date.now() - 1_000) });
      const deferred = await deferJob({ jobId: job.id, owner: "dono", delaySeconds: 30 });

      expect(deferred!.status).toBe("CONCILIACAO");
      expect(deferred!.lastErrorCode).toBe("PRAZO_DE_ESPERA_ESTOURADO");
      expect(deferred!.attempts).toBe(0);
      expect(deferred!.finishedAt).toBeNull();
    });

    it("keeps waiting while the deadline is still ahead", async () => {
      const job = await claimed({ pollDeadlineAt: new Date(Date.now() + 60_000) });
      const deferred = await deferJob({ jobId: job.id, owner: "dono", delaySeconds: 30 });

      expect(deferred!.status).toBe("PENDENTE");
    });
  });

  describe("pausing counts nothing", () => {
    it("records the reason and a time to look again", async () => {
      const job = await claimed();
      const paused = await pauseJob({
        jobId: job.id,
        owner: "dono",
        reason: "INTEGRACAO_DESLIGADA",
        retryAfterSeconds: 300,
      });

      expect(paused!.status).toBe("PAUSADO");
      expect(paused!.pausedReason).toBe("INTEGRACAO_DESLIGADA");
      expect(paused!.attempts).toBe(0);
      expect(paused!.pollCount).toBe(0);
      expect(paused!.runAfter.getTime()).toBeGreaterThan(Date.now() + 240_000);
    });
  });

  describe("a real failure, and only it, spends an attempt", () => {
    it("increments attempts and backs off", async () => {
      const job = await claimed();
      const failed = await failJobRecoverable({
        jobId: job.id,
        owner: "dono",
        error: new JobRefusal("PAYLOAD_INVALIDO"),
        random: () => 0.5,
      });

      expect(failed!.attempts).toBe(1);
      expect(failed!.status).toBe("PENDENTE");
      expect(failed!.pollCount).toBe(0);
      // Full jitter at attempt 0, halfway through a thirty-second window.
      expect(failed!.runAfter.getTime()).toBeGreaterThan(Date.now() + 10_000);
    });

    it("reaches the dead letter when the attempts run out", async () => {
      let job = await claimed({ maxAttempts: 3 });

      for (let i = 0; i < 3; i += 1) {
        const failed = await failJobRecoverable({
          jobId: job.id,
          owner: "dono",
          error: new JobRefusal("PAYLOAD_INVALIDO"),
          random: () => 0,
        });
        if (i < 2) {
          expect(failed!.status).toBe("PENDENTE");
          job = (await claimJob({ owner: "dono" }))!;
        } else {
          expect(failed!.status).toBe("CARTA_MORTA");
          expect(failed!.attempts).toBe(3);
          expect(failed!.finishedAt).not.toBeNull();
        }
      }
    });

    it("ends the job without retrying when the failure is understood", async () => {
      const job = await claimed();
      const failed = await failJobPermanent({
        jobId: job.id,
        owner: "dono",
        error: new JobRefusal("PROJETO_DE_OUTRA_ORGANIZACAO"),
      });

      expect(failed!.status).toBe("FALHOU");
      expect(failed!.attempts).toBe(0);
      expect(failed!.lastErrorCode).toBe("PROJETO_DE_OUTRA_ORGANIZACAO");
    });

    it("leaves conciliation open instead of ending it", async () => {
      const job = await claimed();
      const failed = await failJobPermanent({
        jobId: job.id,
        owner: "dono",
        error: new JobRefusal("PAYLOAD_INVALIDO"),
        as: "CONCILIACAO",
      });

      expect(failed!.status).toBe("CONCILIACAO");
      // Not an ending: the project stays blocked until a person resolves it.
      expect(failed!.finishedAt).toBeNull();
    });
  });

  describe("only the holder settles a job", () => {
    it.each([
      ["completeJob", (id: string) => completeJob({ jobId: id, owner: "intruso" })],
      [
        "deferJob",
        (id: string) => deferJob({ jobId: id, owner: "intruso", delaySeconds: 10 }),
      ],
      [
        "pauseJob",
        (id: string) => pauseJob({ jobId: id, owner: "intruso", reason: "X", retryAfterSeconds: 10 }),
      ],
      [
        "failJobRecoverable",
        (id: string) =>
          failJobRecoverable({ jobId: id, owner: "intruso", error: new JobRefusal("PAYLOAD_INVALIDO") }),
      ],
      [
        "failJobPermanent",
        (id: string) =>
          failJobPermanent({ jobId: id, owner: "intruso", error: new JobRefusal("PAYLOAD_INVALIDO") }),
      ],
    ])("%s does nothing for a consumer that does not hold it", async (_name, settle) => {
      // A consumer whose lease lapsed and that finished late must not settle a
      // job someone else is now running — the same duplicate-effect hazard the
      // lease exists to prevent, arriving one step later.
      const job = await claimed();

      expect(await settle(job.id)).toBeNull();

      const untouched = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(untouched.status).toBe("EM_EXECUCAO");
      expect(untouched.leaseOwner).toBe("dono");
    });
  });

  describe("a terminal job frees the project", () => {
    it.each(["CONCLUIDO", "FALHOU", "CARTA_MORTA"] as const)(
      "lets the next generation in after %s",
      async (terminal) => {
        const first = await prisma.$transaction((tx) =>
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

        const held = (await claimJob({ owner: "dono" }))!;
        expect(held.id).toBe(first.id);

        if (terminal === "CONCLUIDO") {
          await completeJob({ jobId: held.id, owner: "dono" });
        } else if (terminal === "FALHOU") {
          await failJobPermanent({
            jobId: held.id,
            owner: "dono",
            error: new JobRefusal("PAYLOAD_INVALIDO"),
          });
        } else {
          await prisma.job.update({
            where: { id: held.id },
            data: { attempts: 4, maxAttempts: 5 },
          });
          await prisma.job.update({
            where: { id: held.id },
            data: { status: "EM_EXECUCAO", leaseOwner: "dono", leaseExpiresAt: new Date(Date.now() + 60_000) },
          });
          const dead = await failJobRecoverable({
            jobId: held.id,
            owner: "dono",
            error: new JobRefusal("PAYLOAD_INVALIDO"),
          });
          expect(dead!.status).toBe("CARTA_MORTA");
        }

        // The exclusion lives in a partial index over live rows, so the proof
        // that a terminal job released it is a second enqueue that succeeds.
        const brief = await prisma.siteBriefVersion.findFirstOrThrow({
          where: { siteProjectId: fx.siteProjectId },
        });
        const nextRun = await prisma.generationRun.create({
          data: {
            siteProjectId: fx.siteProjectId,
            briefVersionId: brief.id,
            provider: "manual",
            requestJson: "{}",
          },
        });

        const second = await prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: {
              kind: "generation.start",
              generationRunId: nextRun.id,
              siteProjectId: fx.siteProjectId,
            },
            payload: { generationRunId: nextRun.id },
            siteProjectId: fx.siteProjectId,
            generationRunId: nextRun.id,
          }),
        );

        expect(second.id).not.toBe(first.id);
      },
    );

    it("keeps the project blocked while the job is in conciliation", async () => {
      const first = await prisma.$transaction((tx) =>
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
      const held = (await claimJob({ owner: "dono" }))!;
      expect(held.id).toBe(first.id);

      await failJobPermanent({
        jobId: held.id,
        owner: "dono",
        error: new JobRefusal("PAYLOAD_INVALIDO"),
        as: "CONCILIACAO",
      });

      const brief = await prisma.siteBriefVersion.findFirstOrThrow({
        where: { siteProjectId: fx.siteProjectId },
      });
      const nextRun = await prisma.generationRun.create({
        data: {
          siteProjectId: fx.siteProjectId,
          briefVersionId: brief.id,
          provider: "manual",
          requestJson: "{}",
        },
      });

      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: {
              kind: "generation.start",
              generationRunId: nextRun.id,
              siteProjectId: fx.siteProjectId,
            },
            payload: { generationRunId: nextRun.id },
            siteProjectId: fx.siteProjectId,
            generationRunId: nextRun.id,
          }),
        ),
      ).rejects.toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });
    });
  });

  describe.each(LEAKS)("an error carrying %s", (_label, raw) => {
    it("leaves no fragment of it in the row or in the log", async () => {
      const logged: unknown[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
        logged.push(...args);
      });

      let stored;
      try {
        const job = await claimed();
        stored = await failJobRecoverable({
          jobId: job.id,
          owner: "dono",
          error: new Error(raw),
          step: "generation.poll",
        });
      } finally {
        spy.mockRestore();
      }

      const written = JSON.stringify(stored) + JSON.stringify(logged);
      for (const fragment of fragments(raw)) {
        expect(written).not.toContain(fragment);
      }
      expect(written).not.toContain(raw);

      // The failure was recorded — safely, and findable by correlation id.
      expect(stored!.lastErrorCode).toBe("ERRO_INESPERADO");
      expect(stored!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(stored!.lastError).toContain(stored!.correlationId!);
    });
  });

  it("keeps a known refusal on its own text, with no correlation id", async () => {
    const job = await claimed();
    const failed = await failJobRecoverable({
      jobId: job.id,
      owner: "dono",
      error: new JobRefusal("TRABALHO_EM_ANDAMENTO"),
    });

    expect(failed!.lastErrorCode).toBe("TRABALHO_EM_ANDAMENTO");
    expect(failed!.correlationId).toBeNull();
    expect(failed!.lastError).toContain("trabalho em andamento");
  });
});
