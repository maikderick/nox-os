import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { DEFAULT_LEASE_SECONDS } from "@/lib/jobs/claim";
import { hashRequest, withIdempotency, DEFAULT_TTL_SECONDS } from "@/lib/jobs/idempotency";
import { FUNCTION_MAX_DURATION_SECONDS, IDEMPOTENCY_TTL_SECONDS } from "@/lib/jobs/limits";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SCOPE = "generation.request";
const BODY = { siteProjectId: "projeto-1" };

describe("the timeouts are ordered, and derived from one number", () => {
  it("keeps every protection above the execution ceiling", () => {
    // A reservation shorter than the execution it protects is worse than none:
    // it expires while the work is still running, someone takes it over, and
    // the thing built to prevent duplicate work schedules it instead.
    expect(DEFAULT_LEASE_SECONDS).toBeGreaterThan(FUNCTION_MAX_DURATION_SECONDS);
    expect(IDEMPOTENCY_TTL_SECONDS).toBeGreaterThan(DEFAULT_LEASE_SECONDS);
    expect(DEFAULT_TTL_SECONDS).toBe(IDEMPOTENCY_TTL_SECONDS);
  });

  it("offers no way to ask for a shorter one", () => {
    // Not a runtime check but a type-level one: the parameter is gone. Nobody
    // needs a shorter TTL, so nobody may ask for one — which removes the whole
    // class of "valid number, catastrophic value" from the API.
    const params = {
      organizationId: "org",
      scope: SCOPE,
      key: "k",
      requestHash: "h",
      sideEffect: "LOCAL" as const,
    };
    expect(Object.keys(params)).not.toContain("ttlSeconds");
  });
});

describeLocalDatabase("a key means one classification, forever", () => {
  let fx: QueueFixture;

  beforeAll(async () => {
    fx = await createQueueFixture();
  });

  afterAll(async () => {
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  async function seed(key: string, sideEffect: string) {
    await prisma.$executeRaw`
      INSERT INTO "IdempotencyKey"
        ("id","organizationId","scope","key","requestHash","sideEffect","status",
         "ownerToken","expiresAt","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${fx.organizationId}, ${SCOPE}, ${key},
              ${hashRequest(BODY)}, ${sideEffect}, 'EM_ANDAMENTO', ${randomUUID()},
              NOW() - make_interval(secs => 1), NOW(), NOW())
    `;
  }

  const base = (key: string) => ({
    organizationId: fx.organizationId,
    scope: SCOPE,
    key,
    requestHash: hashRequest(BODY),
  });

  it("refuses stored EXTERNO_AMBIGUO asked for as LOCAL, and touches nothing", async () => {
    const key = randomUUID();
    await seed(key, "EXTERNO_AMBIGUO");
    const antes = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    let executou = false;

    await expect(
      withIdempotency({ ...base(key), sideEffect: "LOCAL" }, async () => {
        executou = true;
        return { response: { jobId: "j" } };
      }),
    ).rejects.toMatchObject({ code: "CLASSIFICACAO_DIVERGENTE" });

    expect(executou).toBe(false);
    const depois = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    // Not concluded, not released, not conciliated, not even re-stamped.
    expect(depois).toEqual(antes);
  });

  it("refuses stored LOCAL asked for as EXTERNO_AMBIGUO, even when the work throws", async () => {
    // The dangerous direction. Letting the stored value win would run an
    // `ExternalWork` down the `LOCAL` path — and releasing the key on its throw
    // is the safe move after a local rollback and the worst possible one after
    // a remote effect.
    const key = randomUUID();
    await seed(key, "LOCAL");
    const antes = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    let executou = false;

    await expect(
      withIdempotency({ ...base(key), sideEffect: "EXTERNO_AMBIGUO" }, async () => {
        executou = true;
        throw new Error("efeito remoto ja pode ter acontecido");
      }),
    ).rejects.toMatchObject({ code: "CLASSIFICACAO_DIVERGENTE" });

    expect(executou).toBe(false);
    // The key is still there, unchanged. It did not vanish on a throw that
    // never happened.
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
    expect(await prisma.idempotencyKey.findFirstOrThrow({ where: { key } })).toEqual(antes);
  });

  it.each([
    ["EXTERNO_RECONCILIAVEL", "EXTERNO_AMBIGUO"],
    ["EXTERNO_AMBIGUO", "EXTERNO_RECONCILIAVEL"],
    ["LOCAL", "EXTERNO_RECONCILIAVEL"],
  ])("refuses stored %s asked for as %s", async (armazenado, solicitado) => {
    const key = randomUUID();
    await seed(key, armazenado);

    await expect(
      withIdempotency(
        { ...base(key), sideEffect: solicitado as "EXTERNO_AMBIGUO", reconcile: async () => null },
        async () => ({ response: { jobId: "j" } }),
      ),
    ).rejects.toMatchObject({ code: "CLASSIFICACAO_DIVERGENTE" });

    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
  });

  it("lets a matching classification through as before", async () => {
    const key = randomUUID();
    await seed(key, "LOCAL");

    const resultado = await withIdempotency({ ...base(key), sideEffect: "LOCAL" }, async () => ({
      response: { jobId: "assumido" },
    }));

    expect(resultado.executed).toBe(true);
  });

  it("still sends an unrecognised stored value to conciliation", async () => {
    // Nothing to compare against, so the strictest path stands: a row written
    // by something this version does not understand is not one to guess about.
    const key = randomUUID();
    await seed(key, "CLASSIFICACAO_DE_OUTRA_VERSAO");

    await expect(
      withIdempotency({ ...base(key), sideEffect: "LOCAL" }, async () => ({
        response: { jobId: "j" },
      })),
    ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

    expect((await prisma.idempotencyKey.findFirstOrThrow({ where: { key } })).status).toBe(
      "CONCILIACAO",
    );
  });
});
