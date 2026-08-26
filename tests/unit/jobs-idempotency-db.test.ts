import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import {
  DEFAULT_TTL_MS,
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

  /** Counts executions so "did it run again?" is a fact, not an inference. */
  function work(response: IdempotentResponse, counter: { runs: number }) {
    return async () => {
      counter.runs += 1;
      return { response, result: response };
    };
  }

  const body = { siteProjectId: "projeto-1", briefing: 3 };

  describe("the scope is never global", () => {
    it("lets two organizations use the same key without meeting", async () => {
      // The key is chosen by the client. Two of them picking the same UUID —
      // or the same string — must not make one see the other's answer.
      const key = randomUUID();
      const a = { runs: 0 };
      const b = { runs: 0 };

      const respostaA = await withIdempotency(
        {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
        },
        work({ generationRunId: "run-de-a" }, a),
      );
      const respostaB = await withIdempotency(
        {
          organizationId: fx.otherOrganizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
        },
        work({ generationRunId: "run-de-b" }, b),
      );

      expect(a.runs).toBe(1);
      expect(b.runs).toBe(1);
      expect(respostaA.response.generationRunId).toBe("run-de-a");
      expect(respostaB.response.generationRunId).toBe("run-de-b");
    });

    it("refuses a call with no organization", async () => {
      await expect(
        withIdempotency(
          {
            organizationId: "",
            scope: SCOPE,
            key: randomUUID(),
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "x" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });
    });

    it("keeps one scope's keys away from another's", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const base = {
        organizationId: fx.organizationId,
        key,
        requestHash: hashRequest(body),
        sideEffect: "LOCAL" as const,
      };

      await withIdempotency({ ...base, scope: "generation.request" }, work({ jobId: "j1" }, contador));
      await withIdempotency({ ...base, scope: "outro.escopo" }, work({ jobId: "j2" }, contador));

      expect(contador.runs).toBe(2);
    });
  });

  describe("a second call with the same body", () => {
    it("returns the recorded response without running anything", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const params = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        requestHash: hashRequest(body),
        sideEffect: "LOCAL" as const,
      };

      const primeira = await withIdempotency(params, work({ generationRunId: "run-1" }, contador));
      const segunda = await withIdempotency(params, work({ generationRunId: "run-2" }, contador));

      expect(contador.runs).toBe(1);
      expect(primeira.executed).toBe(true);
      expect(segunda.executed).toBe(false);
      expect(segunda.response).toEqual({ generationRunId: "run-1" });
    });

    it("keeps answering the same thing however many times it is asked", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const params = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        requestHash: hashRequest(body),
        sideEffect: "LOCAL" as const,
      };

      await withIdempotency(params, work({ generationRunId: "run-1" }, contador));
      for (let i = 0; i < 5; i += 1) {
        const outra = await withIdempotency(params, work({ generationRunId: "outro" }, contador));
        expect(outra.response).toEqual({ generationRunId: "run-1" });
      }
      expect(contador.runs).toBe(1);
    });
  });

  describe("the same key with a different body", () => {
    it("is refused, and the first answer is untouched", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const base = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        sideEffect: "LOCAL" as const,
      };

      await withIdempotency(
        { ...base, requestHash: hashRequest(body) },
        work({ generationRunId: "run-1" }, contador),
      );

      await expect(
        withIdempotency(
          { ...base, requestHash: hashRequest({ ...body, briefing: 4 }) },
          work({ generationRunId: "run-2" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CORPO_DIVERGENTE" });

      expect(contador.runs).toBe(1);
      const gravada = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(decodeResponse(gravada.responseJson!)).toEqual({ generationRunId: "run-1" });
    });

    it("is refused while the first is still running, too", async () => {
      // Not "wait your turn" — the key means two different things, and that is
      // wrong regardless of what the first call is doing.
      const key = randomUUID();
      await prisma.idempotencyKey.create({
        data: {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
          expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        },
      });

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest({ outro: "corpo" }),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "x" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "CORPO_DIVERGENTE" });
    });
  });

  describe("a live reservation that has not expired", () => {
    it("tells the second caller to wait instead of starting a second run", async () => {
      const key = randomUUID();
      await prisma.idempotencyKey.create({
        data: {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
          expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        },
      });
      const contador = { runs: 0 };

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "run-2" }, contador),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_EM_ANDAMENTO" });

      expect(contador.runs).toBe(0);
    });
  });

  describe("an expired reservation, and what its declared effect allows", () => {
    async function expired(sideEffect: string, key: string) {
      await prisma.idempotencyKey.create({
        data: {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect,
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
    }

    it("LOCAL may be taken over", async () => {
      // Our writes, our database: they either committed or they did not, and
      // nothing outside can be half-done.
      const key = randomUUID();
      await expired("LOCAL", key);
      const contador = { runs: 0 };

      const resultado = await withIdempotency(
        {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
        },
        work({ generationRunId: "run-assumido" }, contador),
      );

      expect(contador.runs).toBe(1);
      expect(resultado.executed).toBe(true);
      expect(resultado.response).toEqual({ generationRunId: "run-assumido" });
    });

    it("EXTERNO_AMBIGUO goes to conciliation, never to a repeat", async () => {
      // Expiring proves the process died. It proves nothing about what the
      // provider did before it died.
      const key = randomUUID();
      await expired("EXTERNO_AMBIGUO", key);
      const contador = { runs: 0 };

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "EXTERNO_AMBIGUO",
          },
          work({ generationRunId: "nao-deveria" }, contador),
        ),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

      expect(contador.runs).toBe(0);
    });

    it("EXTERNO_RECONCILIAVEL consults before deciding, and adopts what it finds", async () => {
      const key = randomUUID();
      await expired("EXTERNO_RECONCILIAVEL", key);
      const contador = { runs: 0 };
      let consultado = false;

      const resultado = await withIdempotency(
        {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "EXTERNO_RECONCILIAVEL",
          reconcile: async () => {
            consultado = true;
            return { generationRunId: "run-que-ja-existia" };
          },
        },
        work({ generationRunId: "nao-deveria" }, contador),
      );

      expect(consultado).toBe(true);
      expect(contador.runs).toBe(0);
      expect(resultado.executed).toBe(false);
      expect(resultado.response).toEqual({ generationRunId: "run-que-ja-existia" });
    });

    it("EXTERNO_RECONCILIAVEL runs again only when the provider says nothing exists", async () => {
      const key = randomUUID();
      await expired("EXTERNO_RECONCILIAVEL", key);
      const contador = { runs: 0 };

      const resultado = await withIdempotency(
        {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "EXTERNO_RECONCILIAVEL",
          reconcile: async () => null,
        },
        work({ generationRunId: "run-novo" }, contador),
      );

      expect(contador.runs).toBe(1);
      expect(resultado.response).toEqual({ generationRunId: "run-novo" });
    });

    it("EXTERNO_RECONCILIAVEL with no way to reconcile is just the ambiguous case", async () => {
      // Declared reconcilable and given no reconciler. That is not a licence to
      // repeat; it is the ambiguous case wearing the wrong label.
      const key = randomUUID();
      await expired("EXTERNO_RECONCILIAVEL", key);
      const contador = { runs: 0 };

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "EXTERNO_RECONCILIAVEL",
          },
          work({ generationRunId: "nao-deveria" }, contador),
        ),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

      expect(contador.runs).toBe(0);
    });

    it("reads an unrecognised declaration as the most restrictive one", async () => {
      const key = randomUUID();
      await expired("QUALQUER_COISA", key);

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "nao-deveria" }, { runs: 0 }),
        ),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });
    });
  });

  describe("the stored response passes the allowlist", () => {
    it("refuses to record a field nobody declared", async () => {
      // The stored response is served back verbatim to a later caller. A
      // provider's error object serialised "to be helpful" would be returned on
      // request for as long as the key lives.
      const key = randomUUID();

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          async () => ({
            response: {
              generationRunId: "run-1",
              respostaDoProvedor: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            } as IdempotentResponse,
          }),
        ),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });

      // And the reservation is deliberately NOT released. The work already
      // ran — that is what produced the bad response — so letting the next
      // call re-run it would repeat the one thing that must not be repeated.
      // The key stands unanswered, and expiring hands it to the machinery for
      // "we do not know what happened".
      const pendurada = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(pendurada.status).toBe("EM_ANDAMENTO");
      expect(pendurada.responseJson).toBeNull();
    });

    it("keeps that unanswered key out of a blind repeat", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const params = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        requestHash: hashRequest(body),
        sideEffect: "EXTERNO_AMBIGUO" as const,
      };

      await expect(
        withIdempotency(params, async () => {
          contador.runs += 1;
          return { response: { campoInvalido: "x" } as IdempotentResponse };
        }),
      ).rejects.toMatchObject({ code: "PAYLOAD_INVALIDO" });

      // Expire it, and the declared effect decides — not a retry.
      await prisma.idempotencyKey.updateMany({
        where: { key },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await expect(
        withIdempotency(params, work({ generationRunId: "nao-deveria" }, contador)),
      ).rejects.toMatchObject({ code: "EFEITO_EXTERNO_AMBIGUO" });

      expect(contador.runs).toBe(1);
    });

    it("drops an unrecognised field when reading an older row back", async () => {
      const key = randomUUID();
      await prisma.idempotencyKey.create({
        data: {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
          status: "CONCLUIDA",
          responseJson: JSON.stringify({
            generationRunId: "run-1",
            campoAntigo: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          }),
          expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        },
      });

      const resultado = await withIdempotency(
        {
          organizationId: fx.organizationId,
          scope: SCOPE,
          key,
          requestHash: hashRequest(body),
          sideEffect: "LOCAL",
        },
        work({ generationRunId: "nao-deveria" }, { runs: 0 }),
      );

      expect(resultado.response).toEqual({ generationRunId: "run-1" });
      expect(JSON.stringify(resultado)).not.toContain("ghp_");
    });
  });

  describe("work that fails", () => {
    it("releases the key instead of making the caller wait out the TTL", async () => {
      const key = randomUUID();

      await expect(
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          async () => {
            throw new Error("falhou");
          },
        ),
      ).rejects.toThrow("falhou");

      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    });
  });

  describe("the concurrent window", () => {
    it("runs the work once when two callers arrive together", async () => {
      // The insert is what decides. A read followed by a write would let both
      // pass, and this is the shape that catches it.
      const key = randomUUID();
      const contador = { runs: 0 };
      const params = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        requestHash: hashRequest(body),
        sideEffect: "LOCAL" as const,
      };

      const resultados = await Promise.allSettled([
        withIdempotency(params, async () => {
          contador.runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { response: { generationRunId: "run-1" } };
        }),
        withIdempotency(params, async () => {
          contador.runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { response: { generationRunId: "run-2" } };
        }),
      ]);

      expect(contador.runs).toBe(1);
      const cumpridos = resultados.filter((r) => r.status === "fulfilled");
      const recusados = resultados.filter((r) => r.status === "rejected");
      expect(cumpridos).toHaveLength(1);
      expect(recusados).toHaveLength(1);
      // The loser is told someone is on it — not handed a duplicate.
      expect((recusados[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CHAVE_EM_ANDAMENTO",
      });
    });

    it("holds with more than two, and leaves exactly one row", async () => {
      const key = randomUUID();
      const contador = { runs: 0 };
      const params = {
        organizationId: fx.organizationId,
        scope: SCOPE,
        key,
        requestHash: hashRequest(body),
        sideEffect: "LOCAL" as const,
      };

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          withIdempotency(params, async () => {
            contador.runs += 1;
            await new Promise((resolve) => setTimeout(resolve, 30));
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
        withIdempotency(
          {
            organizationId: fx.organizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "run-de-a" }, contador),
        ),
        withIdempotency(
          {
            organizationId: fx.otherOrganizationId,
            scope: SCOPE,
            key,
            requestHash: hashRequest(body),
            sideEffect: "LOCAL",
          },
          work({ generationRunId: "run-de-b" }, contador),
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
