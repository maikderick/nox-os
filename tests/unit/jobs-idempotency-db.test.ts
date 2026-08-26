import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import {
  DEFAULT_TTL_SECONDS,
  decodeResponse,
  hashRequest,
  withIdempotency,
  type IdempotentResponse,
} from "@/lib/jobs/idempotency";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SCOPE = "generation.request";
const BODY = { siteProjectId: "projeto-1", briefing: 3 };
const SEGREDO = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describeLocalDatabase("one key, one execution", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  const local = (over: Partial<{ key: string; requestHash: string }> = {}) => ({
    organizationId: fx.organizationId,
    scope: SCOPE,
    key: over.key ?? randomUUID(),
    requestHash: over.requestHash ?? hashRequest(BODY),
    sideEffect: "LOCAL" as const,
  });

  /** Counts executions so "did it run again?" is a fact, not an inference. */
  function counting(response: IdempotentResponse, counter: { runs: number }) {
    return async () => {
      counter.runs += 1;
      return { response };
    };
  }

  /** Seeds a row directly, so a state can be set up without racing to it. */
  async function seed(over: {
    key: string;
    status?: string;
    sideEffect?: string;
    responseJson?: string | null;
    expiredSeconds?: number;
    ownerToken?: string | null;
    requestHash?: string;
  }) {
    const status = over.status ?? "EM_ANDAMENTO";
    const token = status === "EM_ANDAMENTO" ? (over.ownerToken ?? randomUUID()) : null;
    const offset = over.expiredSeconds ?? -1;
    await prisma.$executeRaw`
      INSERT INTO "IdempotencyKey"
        ("id","organizationId","scope","key","requestHash","sideEffect","status",
         "ownerToken","responseJson","expiresAt","createdAt","updatedAt")
      VALUES
        (${randomUUID()}, ${fx.organizationId}, ${SCOPE}, ${over.key},
         ${over.requestHash ?? hashRequest(BODY)}, ${over.sideEffect ?? "LOCAL"}, ${status},
         ${token}, ${over.responseJson ?? null},
         NOW() + make_interval(secs => ${offset}::double precision), NOW(), NOW())
    `;
    return token;
  }

  // ---------------------------------------------------------------- escopo

  describe("the scope is never global", () => {
    it("lets two organizations use the same key without meeting", async () => {
      const key = randomUUID();
      const a = { runs: 0 };
      const b = { runs: 0 };

      const respostaA = await withIdempotency(
        { ...local({ key }) },
        counting({ generationRunId: "run-de-a" }, a),
      );
      const respostaB = await withIdempotency(
        { ...local({ key }), organizationId: fx.otherOrganizationId },
        counting({ generationRunId: "run-de-b" }, b),
      );

      expect([a.runs, b.runs]).toEqual([1, 1]);
      expect(respostaA.response.generationRunId).toBe("run-de-a");
      expect(respostaB.response.generationRunId).toBe("run-de-b");
    });

    it("refuses a call with no organization", async () => {
      await expect(
        withIdempotency(
          { ...local(), organizationId: "" },
          counting({ generationRunId: "x" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });
    });

    it("keeps one scope's keys away from another's", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      await withIdempotency({ ...local({ key }) }, counting({ jobId: "j1" }, contador));
      await withIdempotency(
        { ...local({ key }), scope: "outro.escopo" },
        counting({ jobId: "j2" }, contador),
      );

      expect(contador.runs).toBe(2);
    });
  });

  // ------------------------------------------------------------ mesma chave

  describe("a second call with the same body", () => {
    it("returns the recorded response without running anything", async () => {
      const params = local();
      const contador = { runs: 0 };

      const primeira = await withIdempotency(params, counting({ generationRunId: "run-1" }, contador));
      const segunda = await withIdempotency(params, counting({ generationRunId: "run-2" }, contador));

      expect(contador.runs).toBe(1);
      expect(primeira.executed).toBe(true);
      expect(segunda.executed).toBe(false);
      expect(segunda.response).toEqual({ generationRunId: "run-1" });
    });

    it("answers the same thing however many times it is asked", async () => {
      const params = local();
      const contador = { runs: 0 };
      await withIdempotency(params, counting({ generationRunId: "run-1" }, contador));

      for (let i = 0; i < 5; i += 1) {
        const outra = await withIdempotency(params, counting({ generationRunId: "outro" }, contador));
        expect(outra.response).toEqual({ generationRunId: "run-1" });
      }
      expect(contador.runs).toBe(1);
    });
  });

  describe("property order in the body", () => {
    it("does not matter for objects, and does for arrays", async () => {
      // The decision, stated because it could go the other way: JSON object
      // order is not semantic and varies between clients, so treating it as
      // meaningful would 409 requests that are identical. A list's order was
      // chosen by whoever wrote it, so it is part of the request.
      expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
      expect(hashRequest({ x: { p: 1, q: 2 } })).toBe(hashRequest({ x: { q: 2, p: 1 } }));
      expect(hashRequest({ lista: [1, 2] })).not.toBe(hashRequest({ lista: [2, 1] }));
    });

    it("serves the recorded answer for the same body written differently", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      await withIdempotency(
        { ...local({ key, requestHash: hashRequest({ a: 1, b: 2 }) }) },
        counting({ generationRunId: "run-1" }, contador),
      );
      const segunda = await withIdempotency(
        { ...local({ key, requestHash: hashRequest({ b: 2, a: 1 }) }) },
        counting({ generationRunId: "run-2" }, contador),
      );

      expect(contador.runs).toBe(1);
      expect(segunda.response).toEqual({ generationRunId: "run-1" });
    });

    it("still refuses a genuinely different body", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      await withIdempotency({ ...local({ key }) }, counting({ generationRunId: "run-1" }, contador));

      await expect(
        withIdempotency(
          { ...local({ key, requestHash: hashRequest({ ...BODY, briefing: 4 }) }) },
          counting({ generationRunId: "run-2" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CORPO_DIVERGENTE" });

      expect(contador.runs).toBe(1);
      const gravada = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(decodeResponse(gravada.responseJson!)).toEqual({ generationRunId: "run-1" });
    });

    it("refuses a different body while the first is still running", async () => {
      const key = randomUUID();
      await seed({ key, expiredSeconds: DEFAULT_TTL_SECONDS });

      await expect(
        withIdempotency(
          { ...local({ key, requestHash: hashRequest({ outro: "corpo" }) }) },
          counting({ generationRunId: "x" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "CORPO_DIVERGENTE" });
    });
  });

  describe("a live reservation", () => {
    it("tells the second caller to wait instead of starting a second run", async () => {
      const key = randomUUID();
      await seed({ key, expiredSeconds: DEFAULT_TTL_SECONDS });
      const contador = { runs: 0 };

      await expect(
        withIdempotency({ ...local({ key }) }, counting({ generationRunId: "run-2" }, contador)),
      ).rejects.toMatchObject({ code: "CHAVE_EM_ANDAMENTO" });

      expect(contador.runs).toBe(0);
    });
  });

  // ----------------------------------------------------------- takeover

  describe("taking over an expired reservation is atomic", () => {
    it("runs the work once for two simultaneous takeovers", async () => {
      // Renewing `expiresAt` is not taking possession: both callers would renew
      // and both would run. The condition and the new token are one statement.
      const key = randomUUID();
      await seed({ key, sideEffect: "LOCAL" });
      const contador = { runs: 0 };

      const resultados = await Promise.allSettled([
        withIdempotency({ ...local({ key }) }, async () => {
          contador.runs += 1;
          await new Promise((r) => setTimeout(r, 60));
          return { response: { generationRunId: "run-a" } };
        }),
        withIdempotency({ ...local({ key }) }, async () => {
          contador.runs += 1;
          await new Promise((r) => setTimeout(r, 60));
          return { response: { generationRunId: "run-b" } };
        }),
      ]);

      expect(contador.runs).toBe(1);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
    });

    it("still runs it once for six", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "LOCAL" });
      const contador = { runs: 0 };

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          withIdempotency({ ...local({ key }) }, async () => {
            contador.runs += 1;
            await new Promise((r) => setTimeout(r, 40));
            return { response: { generationRunId: `run-${i}` } };
          }),
        ),
      );

      expect(contador.runs).toBe(1);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("does not let an old executor overwrite the one that took its place", async () => {
      // The heart of it. The old executor finishes late, its `conclude` matches
      // no row because the token changed, and its whole transaction — domain
      // writes included — goes back.
      const key = randomUUID();
      const tokenAntigo = await seed({ key, sideEffect: "LOCAL" });

      // Someone takes over while the old executor is still working.
      const novoToken = randomUUID();
      await prisma.$executeRaw`
        UPDATE "IdempotencyKey"
           SET "ownerToken" = ${novoToken},
               "expiresAt" = NOW() + make_interval(secs => 600)
         WHERE "key" = ${key} AND "ownerToken" = ${tokenAntigo}
      `;
      await prisma.$executeRaw`
        UPDATE "IdempotencyKey"
           SET "status" = 'CONCLUIDA', "responseJson" = ${JSON.stringify({ generationRunId: "do-novo" })},
               "ownerToken" = NULL
         WHERE "key" = ${key} AND "ownerToken" = ${novoToken}
      `;

      // The old executor now arrives with its answer. It is not served: the key
      // is finished, and what it reads back is the new owner's result.
      const tardio = await withIdempotency(
        { ...local({ key }) },
        counting({ generationRunId: "do-antigo" }, { runs: 0 }),
      );

      expect(tardio.executed).toBe(false);
      expect(tardio.response).toEqual({ generationRunId: "do-novo" });
    });

    it("rolls back the late executor's local writes when it loses possession", async () => {
      const key = randomUUID();
      const meuToken = await seed({ key, sideEffect: "LOCAL" });
      const clientSlug = `tardio-${fx.token}-${randomUUID().slice(0, 8)}`;

      // This caller takes over, then someone else takes over from it mid-work.
      await expect(
        withIdempotency({ ...local({ key }) }, async (tx) => {
          await tx.client.create({
            data: { organizationId: fx.organizationId, name: "Tardio", slug: clientSlug },
          });
          // Possession changes underneath, in another connection.
          await prisma.$executeRaw`
            UPDATE "IdempotencyKey" SET "ownerToken" = ${randomUUID()}
             WHERE "key" = ${key}
          `;
          return { response: { generationRunId: "nao-deveria" } };
        }),
      ).rejects.toMatchObject({ code: "POSSE_PERDIDA" });

      // Nothing of its work survives, and it did not release someone else's key.
      expect(await prisma.client.count({ where: { slug: clientSlug } })).toBe(0);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
      void meuToken;
    });
  });

  // --------------------------------------------------- efeito por declaração

  describe("an expired reservation, and what its declared effect allows", () => {
    it("LOCAL may be taken over", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "LOCAL" });
      const contador = { runs: 0 };

      const resultado = await withIdempotency(
        { ...local({ key }) },
        counting({ generationRunId: "run-assumido" }, contador),
      );

      expect(contador.runs).toBe(1);
      expect(resultado.response).toEqual({ generationRunId: "run-assumido" });
    });

    it("EXTERNO_AMBIGUO goes to conciliation, durably, never to a repeat", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "EXTERNO_AMBIGUO" });
      const contador = { runs: 0 };

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
          counting({ generationRunId: "nao-deveria" }, contador),
        ),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

      expect(contador.runs).toBe(0);
      // Recorded, not rediscovered by every later caller.
      const linha = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(linha.status).toBe("CONCILIACAO");
      expect(linha.ownerToken).toBeNull();
    });

    it("EXTERNO_RECONCILIAVEL consults before deciding, and adopts what it finds", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "EXTERNO_RECONCILIAVEL" });
      const contador = { runs: 0 };
      let consultado = false;

      const resultado = await withIdempotency(
        {
          ...local({ key }),
          sideEffect: "EXTERNO_RECONCILIAVEL",
          reconcile: async () => {
            consultado = true;
            return { generationRunId: "run-que-ja-existia" };
          },
        },
        counting({ generationRunId: "nao-deveria" }, contador),
      );

      expect(consultado).toBe(true);
      expect(contador.runs).toBe(0);
      expect(resultado.executed).toBe(false);
      expect(resultado.response).toEqual({ generationRunId: "run-que-ja-existia" });
    });

    it("EXTERNO_RECONCILIAVEL runs again only when the provider says nothing exists", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "EXTERNO_RECONCILIAVEL" });
      const contador = { runs: 0 };

      const resultado = await withIdempotency(
        { ...local({ key }), sideEffect: "EXTERNO_RECONCILIAVEL", reconcile: async () => null },
        counting({ generationRunId: "run-novo" }, contador),
      );

      expect(contador.runs).toBe(1);
      expect(resultado.response).toEqual({ generationRunId: "run-novo" });
    });

    it("EXTERNO_RECONCILIAVEL with no reconciler is the ambiguous case in disguise", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "EXTERNO_RECONCILIAVEL" });

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_RECONCILIAVEL" },
          counting({ generationRunId: "nao-deveria" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

      expect((await prisma.idempotencyKey.findFirstOrThrow({ where: { key } })).status).toBe(
        "CONCILIACAO",
      );
    });

    it("reads the stored declaration, not the caller's", async () => {
      // A caller arriving with a friendlier declaration does not get to
      // reclassify work someone else started.
      const key = randomUUID();
      await seed({ key, sideEffect: "EXTERNO_AMBIGUO" });

      await expect(
        withIdempotency({ ...local({ key }) }, counting({ generationRunId: "x" }, { runs: 0 })),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });
    });

    it("reads an unrecognised declaration as the most restrictive one", async () => {
      const key = randomUUID();
      await seed({ key, sideEffect: "QUALQUER_COISA" });

      await expect(
        withIdempotency({ ...local({ key }) }, counting({ generationRunId: "x" }, { runs: 0 })),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });
    });
  });

  // ------------------------------------------------- exceção não libera

  describe("work that throws", () => {
    it("LOCAL releases the key, because the transaction demonstrably rolled back", async () => {
      const key = randomUUID();

      await expect(
        withIdempotency({ ...local({ key }) }, async () => {
          throw new Error("falhou");
        }),
      ).rejects.toThrow("falhou");

      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    });

    it("LOCAL takes its domain writes with it", async () => {
      const key = randomUUID();
      const clientSlug = `derrubado-${fx.token}-${randomUUID().slice(0, 8)}`;

      await expect(
        withIdempotency({ ...local({ key }) }, async (tx) => {
          await tx.client.create({
            data: { organizationId: fx.organizationId, name: "Derrubado", slug: clientSlug },
          });
          throw new Error("depois de escrever");
        }),
      ).rejects.toThrow("depois de escrever");

      // The entity and the completion fall together — no orphan.
      expect(await prisma.client.count({ where: { slug: clientSlug } })).toBe(0);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    });

    it("EXTERNO_AMBIGUO keeps the key and refuses the repeat", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      await expect(
        withIdempotency({ ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" }, async () => {
          contador.runs += 1;
          throw new Error("provedor caiu no meio");
        }),
      ).rejects.toThrow("provedor caiu no meio");

      // Not deleted: throwing proves the process failed, not that the provider
      // did nothing first.
      const linha = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(linha.status).toBe("CONCILIACAO");

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
          counting({ generationRunId: "x" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_EM_CONCILIACAO" });

      expect(contador.runs).toBe(1);
    });

    it("EXTERNO_RECONCILIAVEL keeps the key, and the next call reconciles first", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const ordem: string[] = [];

      await expect(
        withIdempotency({ ...local({ key }), sideEffect: "EXTERNO_RECONCILIAVEL" }, async () => {
          ordem.push("trabalho-1");
          throw new Error("provedor caiu");
        }),
      ).rejects.toThrow("provedor caiu");

      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);

      const resultado = await withIdempotency(
        {
          ...local({ key }),
          sideEffect: "EXTERNO_RECONCILIAVEL",
          reconcile: async () => {
            ordem.push("reconcilia");
            return { generationRunId: "existia-mesmo" };
          },
        },
        counting({ generationRunId: "nao-deveria" }, contador),
      );

      // Consulted before anything else, and the work never ran again.
      expect(ordem).toEqual(["trabalho-1", "reconcilia"]);
      expect(contador.runs).toBe(0);
      expect(resultado.response).toEqual({ generationRunId: "existia-mesmo" });
    });
  });

  // ---------------------------------------------------------- allowlist

  describe("the stored response passes the allowlist", () => {
    it("LOCAL reverts the local work instead of leaving an orphan", async () => {
      const key = randomUUID();
      const clientSlug = `orfao-${fx.token}-${randomUUID().slice(0, 8)}`;

      await expect(
        withIdempotency({ ...local({ key }) }, async (tx) => {
          await tx.client.create({
            data: { organizationId: fx.organizationId, name: "Orfao", slug: clientSlug },
          });
          return {
            response: { generationRunId: "run-1", respostaDoProvedor: SEGREDO } as IdempotentResponse,
          };
        }),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });

      expect(await prisma.client.count({ where: { slug: clientSlug } })).toBe(0);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    });

    it("external neither releases nor repeats", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      await expect(
        withIdempotency({ ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" }, async () => {
          contador.runs += 1;
          return { response: { campoInvalido: SEGREDO } as IdempotentResponse };
        }),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });

      // The work already happened — that is what produced the bad response — so
      // releasing would authorise repeating it.
      const linha = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(linha.status).toBe("EM_ANDAMENTO");
      expect(linha.responseJson).toBeNull();

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
          counting({ generationRunId: "x" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_EM_ANDAMENTO" });
      expect(contador.runs).toBe(1);
    });

    it("drops an unrecognised field when reading an older row back", async () => {
      const key = randomUUID();
      await seed({
        key,
        status: "CONCLUIDA",
        responseJson: JSON.stringify({ generationRunId: "run-1", campoAntigo: SEGREDO }),
        expiredSeconds: DEFAULT_TTL_SECONDS,
      });

      const resultado = await withIdempotency(
        { ...local({ key }) },
        counting({ generationRunId: "nao-deveria" }, { runs: 0 }),
      );

      expect(resultado.response).toEqual({ generationRunId: "run-1" });
      expect(JSON.stringify(resultado)).not.toContain("ghp_");
    });

    it("never persists provider text, in the response or in a refusal", async () => {
      const key = randomUUID();

      const erro = await withIdempotency(
        { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
        async () => ({ response: { qualquerCoisa: SEGREDO } as IdempotentResponse }),
      ).catch((e: unknown) => e);

      const linha = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      const escrito = JSON.stringify(linha) + JSON.stringify(erro) + String((erro as Error).message);

      expect(escrito).not.toContain(SEGREDO);
      expect(escrito).not.toContain("ghp_");
    });
  });

  // ------------------------------------------------------------ conciliação

  describe("CONCILIACAO is a persisted state", () => {
    it("is never taken over by an ordinary call", async () => {
      const key = randomUUID();
      await seed({ key, status: "CONCILIACAO", sideEffect: "EXTERNO_AMBIGUO" });
      const contador = { runs: 0 };

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
          counting({ generationRunId: "x" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_EM_CONCILIACAO" });

      expect(contador.runs).toBe(0);
      expect((await prisma.idempotencyKey.findFirstOrThrow({ where: { key } })).status).toBe(
        "CONCILIACAO",
      );
    });

    it("stays refused however long it sits there", async () => {
      const key = randomUUID();
      await seed({ key, status: "CONCILIACAO", sideEffect: "EXTERNO_AMBIGUO", expiredSeconds: -86_400 });

      await expect(
        withIdempotency(
          { ...local({ key }), sideEffect: "EXTERNO_AMBIGUO" },
          counting({ generationRunId: "x" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_EM_CONCILIACAO" });
    });

    it("is a value the database itself accepts, and nothing else is", async () => {
      const key = randomUUID();
      await expect(
        prisma.$executeRaw`
          INSERT INTO "IdempotencyKey"
            ("id","organizationId","scope","key","requestHash","sideEffect","status",
             "ownerToken","expiresAt","createdAt","updatedAt")
          VALUES (${randomUUID()}, ${fx.organizationId}, ${SCOPE}, ${key}, 'h', 'LOCAL',
                  'ESTADO_INVENTADO', NULL, NOW(), NOW(), NOW())
        `,
      ).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------- relógio

  describe("the clock is PostgreSQL's", () => {
    function skew(ms: number) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + ms));
    }

    it.each([
      ["duas horas adiantado", 2 * 60 * 60 * 1000],
      ["duas horas atrasado", -2 * 60 * 60 * 1000],
    ])("does not let a %s process clock change what is expired", async (_label, offset) => {
      // A live key must stay live and an expired one must stay expired, whatever
      // this process believes the time is.
      const viva = randomUUID();
      const vencida = randomUUID();
      await seed({ key: viva, expiredSeconds: 600 });
      await seed({ key: vencida, expiredSeconds: -600 });

      skew(offset);
      const contador = { runs: 0 };

      await expect(
        withIdempotency({ ...local({ key: viva }) }, counting({ jobId: "x" }, contador)),
      ).rejects.toMatchObject({ code: "CHAVE_EM_ANDAMENTO" });

      const assumida = await withIdempotency(
        { ...local({ key: vencida }) },
        counting({ jobId: "assumido" }, contador),
      );
      expect(assumida.executed).toBe(true);
      expect(contador.runs).toBe(1);
    });

    it("stamps a new reservation from the database, not from here", async () => {
      const key = randomUUID();
      skew(24 * 60 * 60 * 1000);

      await withIdempotency({ ...local({ key }) }, async () => ({ response: { jobId: "j" } }));

      vi.useRealTimers();
      const [{ agora }] = await prisma.$queryRaw<Array<{ agora: Date }>>`SELECT NOW() AS "agora"`;
      const linha = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      const restante = linha.expiresAt.getTime() - agora.getTime();

      expect(restante).toBeGreaterThan((DEFAULT_TTL_SECONDS - 30) * 1000);
      expect(restante).toBeLessThan((DEFAULT_TTL_SECONDS + 30) * 1000);
    });
  });

  // --------------------------------------------------------- concorrência

  describe("the concurrent window on a fresh key", () => {
    it("runs the work once when several callers arrive together", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          withIdempotency({ ...local({ key }) }, async () => {
            contador.runs += 1;
            await new Promise((r) => setTimeout(r, 30));
            return { response: { generationRunId: `run-${i}` } };
          }),
        ),
      );

      expect(contador.runs).toBe(1);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
    });

    it("lets two organizations race the same key independently", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };

      const resultados = await Promise.all([
        withIdempotency({ ...local({ key }) }, counting({ generationRunId: "run-de-a" }, contador)),
        withIdempotency(
          { ...local({ key }), organizationId: fx.otherOrganizationId },
          counting({ generationRunId: "run-de-b" }, contador),
        ),
      ]);

      expect(contador.runs).toBe(2);
      expect(resultados.map((r) => r.response.generationRunId).sort()).toEqual([
        "run-de-a",
        "run-de-b",
      ]);
    });
  });
});
