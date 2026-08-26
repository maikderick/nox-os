import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { describeJobError } from "@/lib/jobs/error-record";
import { enqueueJob } from "@/lib/jobs/outbox";
import { failJobPermanent, failJobRecoverable, pauseJob } from "@/lib/jobs/outcomes";
import { JobRefusal, sanitizeJobDetails } from "@/lib/jobs/reasons";

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

/**
 * A `JobRefusal` that is one by inheritance and by nothing else.
 *
 * This is the case `instanceof` cannot see. The class is exported and its
 * fields are plain properties, so a subclass — or any code holding an instance
 * — decides what `reason`, `details` and `message` contain. Trusting the
 * ancestry and copying the contents is exactly how a provider response reaches
 * a column wrapped in one of our own types.
 */
class RefusalForjada extends JobRefusal {
  constructor(secret: string, reason = "TRABALHO_EM_ANDAMENTO") {
    super("TRABALHO_EM_ANDAMENTO");
    (this as { reason: string }).reason = reason;
    (this as { code: string }).code = reason;
    (this as { message: string }).message = secret;
    (this as { details: unknown }).details = {
      kind: secret,
      status: secret,
      attempts: secret,
      extra: secret,
    };
  }
}

describe("nothing unrecognised survives into a message", () => {
  it.each(LEAKS)("drops a forged refusal's details carrying %s", (_label, raw) => {
    const stored = describeJobError(new RefusalForjada(raw), { log: () => {} });

    expect(JSON.stringify(stored)).not.toContain(raw);
    for (const fragment of fragments(raw)) {
      expect(JSON.stringify(stored)).not.toContain(fragment);
    }
    // The reason survived because it is one of ours; the message was rebuilt.
    expect(stored.code).toBe("TRABALHO_EM_ANDAMENTO");
    expect(stored.message).toContain("trabalho em andamento");
  });

  it.each(LEAKS)("withholds everything when the reason itself is forged: %s", (_label, raw) => {
    const stored = describeJobError(new RefusalForjada(raw, raw), { log: () => {} });

    // Not one of ours, so it falls through to the generic path — no message,
    // no code, just a correlation id to find the occurrence by.
    expect(stored.code).toBe("ERRO_INESPERADO");
    expect(stored.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it.each(LEAKS)("logs no fragment of a forged reason either: %s", (_label, raw) => {
    const logged: string[] = [];
    describeJobError(new RefusalForjada(raw, raw), { log: (line) => logged.push(line) });

    const written = logged.join("\n");
    expect(written).not.toContain(raw);
    for (const fragment of fragments(raw)) {
      expect(written).not.toContain(fragment);
    }
    expect(written).toContain("correlacao=");
  });

  it("keeps only values the closed sets recognise", () => {
    expect(
      sanitizeJobDetails({
        kind: "generation.poll",
        status: "PENDENTE",
        attempts: 3,
        maxAttempts: 5,
      }),
    ).toEqual({ kind: "generation.poll", status: "PENDENTE", attempts: 3, maxAttempts: 5 });

    expect(
      sanitizeJobDetails({
        kind: "generation.poll<script>",
        status: "QUALQUER_COISA",
        attempts: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        maxAttempts: Number.POSITIVE_INFINITY,
        outroCampo: "segredo",
      }),
    ).toEqual({});

    expect(sanitizeJobDetails(null)).toEqual({});
    expect(sanitizeJobDetails("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toEqual({});
    expect(sanitizeJobDetails({ attempts: -1 })).toEqual({});
  });

  it("says nothing about the kind it did not recognise", () => {
    // The one circumstance where echoing the input back would be echoing
    // something that failed every check we have.
    const stored = describeJobError(new JobRefusal("TIPO_DESCONHECIDO"), { log: () => {} });

    expect(stored.message).toBe("O tipo de job informado não existe nesta fase.");
    expect(stored.message).not.toContain("undefined");
  });
});

describeLocalDatabase("and nothing unrecognised reaches a column", () => {
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

  async function claimed() {
    await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
      }),
    );
    return (await claimJob({ owner: "dono" }))!;
  }

  it.each(LEAKS)("stores no fragment of a forged refusal carrying %s", async (_label, raw) => {
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
        error: new RefusalForjada(raw, raw),
      });
    } finally {
      spy.mockRestore();
    }

    const written = JSON.stringify(stored) + JSON.stringify(logged);
    for (const fragment of fragments(raw)) {
      expect(written).not.toContain(fragment);
    }
    expect(stored!.lastErrorCode).toBe("ERRO_INESPERADO");
  });

  it.each(LEAKS)("stores no fragment through the permanent path either: %s", async (_label, raw) => {
    const job = await claimed();
    const stored = await failJobPermanent({
      jobId: job.id,
      owner: "dono",
      error: new RefusalForjada(raw),
      as: "CONCILIACAO",
    });

    const written = JSON.stringify(stored);
    for (const fragment of fragments(raw)) {
      expect(written).not.toContain(fragment);
    }
    expect(stored!.status).toBe("CONCILIACAO");
  });

  describe("a pause reason is a decision of ours, not a sentence from elsewhere", () => {
    it("accepts the reasons the brake can actually give", async () => {
      const job = await claimed();
      const paused = await pauseJob({
        jobId: job.id,
        owner: "dono",
        reason: "FREIO_GLOBAL",
        retryAfterSeconds: 300,
      });

      expect(paused!.pausedReason).toBe("FREIO_GLOBAL");
    });

    it.each(LEAKS)("refuses %s as a pause reason, and writes nothing", async (_label, raw) => {
      const job = await claimed();

      await expect(
        pauseJob({
          jobId: job.id,
          owner: "dono",
          // Exactly what a caller holding a provider's explanation would pass.
          reason: raw as never,
          retryAfterSeconds: 300,
        }),
      ).rejects.toMatchObject({ code: "MOTIVO_DE_PAUSA_DESCONHECIDO" });

      const untouched = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(untouched.pausedReason).toBeNull();
      expect(untouched.status).toBe("EM_EXECUCAO");
    });
  });
});
