import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBlindCodeGenerationProvider,
  createFakeCodeGenerationProvider,
  FakeAgentWorld,
} from "@/lib/codegen/fake/fake-agent";
import type { CodeGenerationProvider } from "@/lib/codegen/provider";
import { prisma } from "@/lib/db";
import { classifyStartError } from "@/lib/generation/disposition";
import { startGeneration } from "@/lib/generation/start";
import { GenerationRefusal } from "@/lib/generation/reasons";
import { CreditRefusal } from "@/lib/credits/reasons";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  provisionFakeWorld,
  requestFor,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * Starting a generation: the one step that spends money and cannot be undone.
 *
 * Every test here is about the same question asked at a different moment — may
 * this be called again? — and the answer always comes from
 * `GenerationRun.startDisposition`, never from an error message.
 */
describeLocalDatabase("início da geração", () => {
  let fx: GenerationFixture;
  let world: FakeAgentWorld;
  let provider: CodeGenerationProvider;

  const disposition = async (runId: string) =>
    (await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } })).startDisposition;

  const reservationFor = async (runId: string) =>
    prisma.creditReservation.findUnique({ where: { generationRunId: runId } });

  beforeEach(async () => {
    fx = await createGenerationFixture();
    await provisionFakeWorld(fx);
    world = new FakeAgentWorld();
    world.providerWorld = null;
    provider = createFakeCodeGenerationProvider({ world });
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  describe("primeira tentativa", () => {
    it("reserva, chama e enfileira o poll na mesma transação", async () => {
      const { generationRunId } = await requestFor(fx);

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome).toEqual({ type: "concluido" });
      const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } });
      expect(run.startDisposition).toBe("INICIADO");
      expect(run.providerRunId).toBeTruthy();
      expect(run.providerIdempotencyKey).toBe(`nox-generation-${generationRunId}`);
      expect(run.startAttemptedAt).not.toBeNull();

      const reservation = await reservationFor(generationRunId);
      expect(reservation).toMatchObject({ status: "RESERVADA", amountCents: 1_500 });

      // Born with its watcher, and the poll handed off in the same commit.
      const jobs = await prisma.job.findMany({
        where: { organizationId: fx.organizationId },
        select: { kind: true },
      });
      expect(jobs.map((j) => j.kind).sort()).toEqual([
        "credit.threshold",
        "generation.poll",
        "generation.start",
      ]);
    });

    it("sem preço configurado, nada é reservado nem chamado", async () => {
      const semPreco = await createGenerationFixture({ generationPriceCents: null });
      await provisionFakeWorld(semPreco);
      const { generationRunId } = await requestFor(semPreco);

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome.type).toBe("falha_recuperavel");
      expect(world.startCalls).toEqual([]);
      expect(await reservationFor(generationRunId)).toBeNull();
      // A typed error of ours, before any byte left: proved safe to try again.
      expect(await disposition(generationRunId)).toBe("SEM_EFEITO_COMPROVADO");
    });

    it("sem crédito, start nunca é chamado", async () => {
      const semSaldo = await createGenerationFixture({ balanceCents: 100 });
      await provisionFakeWorld(semSaldo);
      const { generationRunId } = await requestFor(semSaldo);

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome.type).toBe("falha_recuperavel");
      expect(world.startCalls).toEqual([]);
      expect(await reservationFor(generationRunId)).toBeNull();
    });

    it("sem repositório provisionado, recusa antes de reservar", async () => {
      const semRepo = await createGenerationFixture({ withoutRepository: true });
      const { generationRunId } = await requestFor(semRepo);

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome.type).toBe("falha_recuperavel");
      expect(await reservationFor(generationRunId)).toBeNull();
      expect(world.startCalls).toEqual([]);
    });
  });

  describe("a janela do lease e a do crash", () => {
    /**
     * Leaves the run exactly where a process that died mid-call would.
     *
     * `providerRunId` is cleared as well as the disposition being set, and it
     * has to be: the `GenerationRun_iniciado_ck` CHECK refuses `EM_TENTATIVA`
     * alongside a recorded run id, which is precisely the incoherence it exists
     * to prevent. A crash mid-call leaves the key and no id, and so does this.
     */
    const leaveInAttempt = async (generationRunId: string) => {
      await prisma.generationRun.update({
        where: { id: generationRunId },
        data: {
          startDisposition: "EM_TENTATIVA",
          providerRunId: null,
          providerIdempotencyKey: `nox-generation-${generationRunId}`,
        },
      });
    };

    it("EM_TENTATIVA é gravado e comitado antes da chamada", async () => {
      const { generationRunId } = await requestFor(fx);

      // The provider throws where the network would, so the only thing the
      // database can have is what was written *before* the call.
      const morrendo: CodeGenerationProvider = {
        ...provider,
        start: async () => {
          expect(await disposition(generationRunId)).toBe("EM_TENTATIVA");
          throw new Error("timeout");
        },
      };

      const outcome = await startGeneration({ generationRunId, provider: morrendo });

      expect(outcome.type).toBe("falha_permanente");
      expect(await disposition(generationRunId)).toBe("AMBIGUO");
    });

    it("sem as duas capacidades, vai a conciliação e start não é chamado", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId, provider });
      await leaveInAttempt(generationRunId);

      const cego = createBlindCodeGenerationProvider({ world });
      const antes = world.startCalls.length;

      const outcome = await startGeneration({ generationRunId, provider: cego });

      expect(outcome).toMatchObject({ type: "falha_permanente", as: "CONCILIACAO" });
      expect(world.startCalls).toHaveLength(antes);
      // The money stays committed and the account is blocked: releasing would
      // refund a call that may well have happened.
      expect(await reservationFor(generationRunId)).toMatchObject({ status: "CONCILIACAO" });
      expect(
        (await prisma.creditAccount.findUniqueOrThrow({ where: { organizationId: fx.organizationId } }))
          .blockedAt,
      ).not.toBeNull();
    });

    it("com reconcileByKey, consulta e adota em vez de chamar de novo", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId, provider });
      const original = await prisma.generationRun.findUniqueOrThrow({
        where: { id: generationRunId },
      });
      await leaveInAttempt(generationRunId);
      const antes = world.startCalls.length;

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome).toEqual({ type: "concluido" });
      // Adopted, not restarted.
      expect(world.startCalls).toHaveLength(antes);
      const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } });
      expect(run.startDisposition).toBe("INICIADO");
      expect(run.providerRunId).toBe(original.providerRunId);
    });
  });

  describe("a reserva atravessa a retentativa segura", () => {
    it("três falhas seguras deixam uma reserva e um vigia", async () => {
      const { generationRunId } = await requestFor(fx);

      // A typed refusal of ours, raised where the provider call would be: it
      // proves nothing left the process.
      const recusando: CodeGenerationProvider = {
        ...provider,
        start: async () => {
          throw new GenerationRefusal("PROVEDOR_NAO_CONFIGURADO");
        },
      };

      for (let i = 0; i < 3; i += 1) {
        const outcome = await startGeneration({ generationRunId, provider: recusando });
        expect(outcome.type).toBe("falha_recuperavel");
        expect(await disposition(generationRunId)).toBe("SEM_EFEITO_COMPROVADO");
      }

      expect(
        await prisma.creditReservation.count({ where: { organizationId: fx.organizationId } }),
      ).toBe(1);
      expect(
        await prisma.job.count({
          where: { organizationId: fx.organizationId, kind: "credit.threshold" },
        }),
      ).toBe(1);

      // And no release/reserve pairs describing no movement at all.
      const ledger = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
        select: { movement: true },
      });
      expect(ledger.map((l) => l.movement)).toEqual(["RESERVA"]);
    });

    it("a retentativa reusa a mesma reserva e chega ao provedor", async () => {
      const { generationRunId } = await requestFor(fx);
      await prisma.$transaction(async (tx) => {
        await tx.generationRun.update({
          where: { id: generationRunId },
          data: { startDisposition: "SEM_EFEITO_COMPROVADO" },
        });
      });

      // No reservation exists yet in this arrangement, and that is the point:
      // `SEM_EFEITO_COMPROVADO` reserves nothing, it reuses.
      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome).toEqual({ type: "concluido" });
      expect(world.startCalls).toHaveLength(1);
    });
  });

  describe("retomada pós-handoff", () => {
    it("com providerRunId gravado, não chama start e enfileira o poll", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId, provider });
      await prisma.job.deleteMany({
        where: { organizationId: fx.organizationId, kind: "generation.poll" },
      });
      const antes = world.startCalls.length;

      const outcome = await startGeneration({ generationRunId, provider });

      expect(outcome).toEqual({ type: "concluido" });
      expect(world.startCalls).toHaveLength(antes);
      expect(
        await prisma.job.count({
          where: { organizationId: fx.organizationId, kind: "generation.poll" },
        }),
      ).toBe(1);
    });

    it("falha ao enfileirar o poll não grava providerRunId", async () => {
      const { generationRunId } = await requestFor(fx);

      const outcome = await startGeneration({
        generationRunId,
        provider,
        enqueue: async (tx, params) => {
          if (params.step.kind === "generation.poll") throw new Error("falha no handoff");
          const { enqueueJob } = await import("@/lib/jobs/outbox");
          return enqueueJob(tx, params);
        },
      });

      expect(outcome.type).toBe("falha_recuperavel");
      const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } });
      // Rolled back with the transaction — and the agent *is* running, so the
      // disposition stays ambiguous and the retry reconciles instead.
      expect(run.providerRunId).toBeNull();
      expect(run.startDisposition).toBe("EM_TENTATIVA");

      // The retry finds it through the provider instead of firing another.
      const antes = world.startCalls.length;
      await startGeneration({ generationRunId, provider });
      expect(world.startCalls).toHaveLength(antes);
    });
  });

  describe("classificação do erro", () => {
    it("olha o tipo, nunca a mensagem", () => {
      expect(classifyStartError(new CreditRefusal("SALDO_INSUFICIENTE"))).toBe(
        "SEM_EFEITO_COMPROVADO",
      );
      expect(classifyStartError(new GenerationRefusal("BRIEFING_AUSENTE"))).toBe(
        "SEM_EFEITO_COMPROVADO",
      );
      // A timeout wrapped in a helpful sentence containing the word "invalid"
      // is still a timeout, and still proves nothing about the provider.
      expect(classifyStartError(new Error("invalid payload: request timed out"))).toBe("AMBIGUO");
      expect(classifyStartError("uma string qualquer")).toBe("AMBIGUO");
    });
  });
});
