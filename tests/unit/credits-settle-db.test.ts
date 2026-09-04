import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { reserveCredits } from "@/lib/credits/reserve";
import {
  conciliateReservation,
  consumeReservation,
  releaseReservation,
} from "@/lib/credits/settle";
import { watchReservationThreshold } from "@/lib/credits/threshold";
import { startGeneration } from "@/lib/generation/start";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  provisionFakeWorld,
  requestFor,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * Every line of the outcome table, one at a time.
 *
 * The rule the whole file is arranged around: **nothing releases without proof
 * that no paid call happened.** Only `NAO_TENTADO` and `SEM_EFEITO_COMPROVADO`
 * are that proof, and only when nobody is going to try again.
 */
describeLocalDatabase("liquidação de crédito", () => {
  let fx: GenerationFixture;

  beforeEach(async () => {
    fx = await createGenerationFixture();
    await provisionFakeWorld(fx);
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  const account = async () =>
    prisma.creditAccount.findUniqueOrThrow({ where: { organizationId: fx.organizationId } });

  const movements = async () =>
    (
      await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
        select: { movement: true, amountCents: true },
      })
    ).map((line) => `${line.movement}:${line.amountCents}`);

  /** A run with a live reservation, the way `start` leaves one. */
  async function reserved(amountCents = 1_500) {
    const { generationRunId } = await requestFor(fx);
    const reservation = await prisma.$transaction((tx) =>
      reserveCredits(tx, {
        organizationId: fx.organizationId,
        operationKey: `generation:${generationRunId}`,
        amountCents,
        estimatedBy: "PRECO_DA_ORGANIZACAO",
        generationRunId,
      }),
    );
    return { generationRunId, reservation };
  }

  describe("consumo", () => {
    it("devolve a reserva, desconta o saldo e conta no mês", async () => {
      const { reservation } = await reserved();

      await prisma.$transaction((tx) =>
        consumeReservation(tx, { reservationId: reservation.id, actualCents: 1_500 }),
      );

      expect(await account()).toMatchObject({
        reservedCents: 0,
        balanceCents: 100_000 - 1_500,
        consumedThisMonthCents: 1_500,
        blockedAt: null,
      });
      expect(await movements()).toEqual(["RESERVA:0", "CONSUMO:-1500"]);
      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "CONSUMIDA", reconciledCents: 1_500 });
    });

    it("custo real acima da reserva, com espaço, é cobrado inteiro", async () => {
      const { reservation } = await reserved();

      await prisma.$transaction((tx) =>
        consumeReservation(tx, { reservationId: reservation.id, actualCents: 2_000 }),
      );

      expect(await account()).toMatchObject({
        reservedCents: 0,
        balanceCents: 100_000 - 2_000,
        consumedThisMonthCents: 2_000,
      });
    });

    it("custo real acima do saldo bloqueia a conta e nunca fica negativo", async () => {
      const pequeno = await createGenerationFixture({ balanceCents: 2_000 });
      const { generationRunId } = await requestFor(pequeno);
      const reservation = await prisma.$transaction((tx) =>
        reserveCredits(tx, {
          organizationId: pequeno.organizationId,
          operationKey: `generation:${generationRunId}`,
          amountCents: 1_500,
          estimatedBy: "PRECO_DA_ORGANIZACAO",
          generationRunId,
        }),
      );

      await prisma.$transaction((tx) =>
        consumeReservation(tx, { reservationId: reservation.id, actualCents: 9_000 }),
      );

      const conta = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: pequeno.organizationId },
      });
      // Charging what is not there breaks the invariant; charging only the
      // reserved amount would write the difference off in silence.
      expect(conta.balanceCents).toBe(2_000);
      expect(conta.blockedAt).not.toBeNull();
      expect(conta.blockedReasonCode).toBe("CUSTO_ACIMA_DA_RESERVA");
      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "CONCILIACAO" });
    });

    it("uma reserva só é liquidada uma vez", async () => {
      const { reservation } = await reserved();
      await prisma.$transaction((tx) =>
        consumeReservation(tx, { reservationId: reservation.id, actualCents: 1_500 }),
      );

      await expect(
        prisma.$transaction((tx) =>
          consumeReservation(tx, { reservationId: reservation.id, actualCents: 1_500 }),
        ),
      ).rejects.toMatchObject({ code: "RESERVA_NAO_LIQUIDAVEL" });

      expect(await account()).toMatchObject({ balanceCents: 100_000 - 1_500 });
    });
  });

  describe("liberação", () => {
    it("restaura disponível e exposição juntos, sem mover saldo", async () => {
      const { reservation } = await reserved();
      const antes = await account();
      expect(antes.reservedCents).toBe(1_500);

      await prisma.$transaction((tx) =>
        releaseReservation(tx, { reservationId: reservation.id }),
      );

      expect(await account()).toMatchObject({
        reservedCents: 0,
        balanceCents: 100_000,
        consumedThisMonthCents: 0,
      });
      expect(await movements()).toEqual(["RESERVA:0", "LIBERACAO:0"]);
    });
  });

  describe("conciliação", () => {
    it("mantém o dinheiro comprometido e bloqueia a conta", async () => {
      const { reservation } = await reserved();

      await prisma.$transaction((tx) =>
        conciliateReservation(tx, {
          reservationId: reservation.id,
          reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
        }),
      );

      const conta = await account();
      // Deliberately *not* returned: this is the one outcome that is explicitly
      // not a decision.
      expect(conta.reservedCents).toBe(1_500);
      expect(conta.blockedAt).not.toBeNull();
      expect(await movements()).toEqual(["RESERVA:0", "BLOQUEIO:0"]);
    });

    it("bloquear duas vezes não move o carimbo de quando começou", async () => {
      const primeira = await reserved();
      await prisma.$transaction((tx) =>
        conciliateReservation(tx, {
          reservationId: primeira.reservation.id,
          reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
        }),
      );
      const bloqueadoEm = (await account()).blockedAt;

      const segunda = await prisma.creditReservation.create({
        data: {
          organizationId: fx.organizationId,
          operationKey: `avulsa-${fx.token}`,
          amountCents: 100,
          estimatedBy: "PRECO_DA_ORGANIZACAO",
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.$transaction((tx) =>
        conciliateReservation(tx, {
          reservationId: segunda.id,
          reasonCode: "CUSTO_ACIMA_DA_RESERVA",
        }),
      );

      expect((await account()).blockedAt).toEqual(bloqueadoEm);
    });
  });

  describe("o vigia do limiar", () => {
    it("encerra sem renovar quando a reserva já foi liquidada", async () => {
      const { reservation } = await reserved();
      await prisma.$transaction((tx) =>
        consumeReservation(tx, { reservationId: reservation.id, actualCents: 1_500 }),
      );

      expect(await watchReservationThreshold({ reservationId: reservation.id })).toEqual({
        type: "concluido",
      });
    });

    it("renova enquanto o run está confirmado em execução", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });
      const reservation = await prisma.creditReservation.findUniqueOrThrow({
        where: { generationRunId },
      });

      const outcome = await watchReservationThreshold({ reservationId: reservation.id });

      // A two-hour generation is a long generation, not a lost one.
      expect(outcome).toMatchObject({ type: "aguardar" });
      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "RESERVADA" });
    });

    it("renova também na retentativa segura, com o job ainda vivo", async () => {
      const { generationRunId, reservation } = await reserved();
      await prisma.generationRun.update({
        where: { id: generationRunId },
        data: { startDisposition: "SEM_EFEITO_COMPROVADO" },
      });

      const outcome = await watchReservationThreshold({ reservationId: reservation.id });

      expect(outcome).toMatchObject({ type: "aguardar" });
      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "RESERVADA" });
    });

    it("libera quando ninguém vai tentar de novo e nada foi chamado", async () => {
      const { generationRunId, reservation } = await reserved();
      await prisma.generationRun.update({
        where: { id: generationRunId },
        data: { startDisposition: "SEM_EFEITO_COMPROVADO" },
      });
      await prisma.job.updateMany({
        where: { generationRunId, kind: "generation.start" },
        data: { status: "CARTA_MORTA" },
      });

      await watchReservationThreshold({ reservationId: reservation.id });

      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "LIBERADA" });
      expect(await account()).toMatchObject({ reservedCents: 0, balanceCents: 100_000 });
      expect(
        (await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } })).status,
      ).toBe("FALHOU");
    });

    it("bloqueia e concilia quando a disposição é ambígua", async () => {
      const { generationRunId, reservation } = await reserved();
      await prisma.generationRun.update({
        where: { id: generationRunId },
        data: { startDisposition: "EM_TENTATIVA" },
      });

      await watchReservationThreshold({ reservationId: reservation.id });

      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
      ).toMatchObject({ status: "CONCILIACAO" });
      expect((await account()).blockedAt).not.toBeNull();
      // Never released: the call may have happened and been charged for.
      expect((await account()).reservedCents).toBe(1_500);
    });

    it("renovar reusa o mesmo job, e não cria um segundo vigia", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });

      const antes = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId, kind: "credit.threshold" },
      });
      const reservation = await prisma.creditReservation.findUniqueOrThrow({
        where: { generationRunId },
      });

      await watchReservationThreshold({ reservationId: reservation.id });

      const depois = await prisma.job.findMany({
        where: { organizationId: fx.organizationId, kind: "credit.threshold" },
      });
      expect(depois).toHaveLength(1);
      expect(depois[0].id).toBe(antes.id);
      expect(reservation.jobId).toBe(antes.id);
    });
  });
});
