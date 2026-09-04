import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { generationPriceCents } from "@/lib/credits/pricing";
import { rolloverIfDue } from "@/lib/credits/period";
import { reserveCredits, RESERVATION_THRESHOLD_SECONDS } from "@/lib/credits/reserve";
import { LEDGER_MOVEMENTS, RESERVATION_STATUSES } from "@/lib/credits/reasons";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const PRECO = 2_500;

/**
 * Every count here is scoped to the two organizations this suite creates.
 *
 * The `beforeEach` cleans those, and only those. An unscoped `count()` asks the
 * whole table instead, so it answers with whatever every other suite in the run
 * happened to leave behind — and this suite would then pass or fail depending
 * on which files ran before it, which is not a property of the code it is
 * testing.
 */
describeLocalDatabase("credits", () => {
  let fx: QueueFixture;

  beforeAll(async () => {
    fx = await createQueueFixture();
  });

  afterAll(async () => {
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.creditLedgerEntry.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
    await prisma.creditReservation.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
    await prisma.creditAccount.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function conta(over: Partial<{
    balanceCents: number;
    reservedCents: number;
    consumedThisMonthCents: number;
    monthlyCapCents: number;
    generationPriceCents: number | null;
    blockedAt: Date | null;
    organizationId: string;
  }> = {}) {
    return prisma.creditAccount.create({
      data: {
        organizationId: over.organizationId ?? fx.organizationId,
        balanceCents: over.balanceCents ?? 100_000,
        reservedCents: over.reservedCents ?? 0,
        consumedThisMonthCents: over.consumedThisMonthCents ?? 0,
        monthlyCapCents: over.monthlyCapCents ?? 100_000,
        generationPriceCents:
          over.generationPriceCents === undefined ? PRECO : over.generationPriceCents,
        blockedAt: over.blockedAt ?? null,
      },
    });
  }

  const reserva = (over: Partial<Parameters<typeof reserveCredits>[1]> = {}) => ({
    organizationId: fx.organizationId,
    operationKey: `generation:${randomUUID()}`,
    amountCents: PRECO,
    estimatedBy: "PRECO_DA_ORGANIZACAO" as const,
    ...over,
  });

  // ------------------------------------------------------------------ preço

  describe("the price is local policy and nothing else", () => {
    it("reads the organization's own number", async () => {
      await conta();
      expect(await generationPriceCents(prisma, fx.organizationId)).toBe(PRECO);
    });

    it("refuses when nobody set one, before anything is reserved", async () => {
      // Null is not free. It means nobody said, and generating without a price
      // is spending without knowing how much.
      await conta({ generationPriceCents: null });

      await expect(generationPriceCents(prisma, fx.organizationId)).rejects.toMatchObject({
        code: "PRECO_NAO_CONFIGURADO",
      });
    });

    it("refuses when there is no account at all", async () => {
      await expect(generationPriceCents(prisma, fx.organizationId)).rejects.toMatchObject({
        code: "CONTA_NAO_ENCONTRADA",
      });
    });

    it("reaches no network, no secret and no provider client", async () => {
      // The tempting change is small — "just ask the provider what it charges"
      // — and it makes reserving credit depend on the provider being up, which
      // is precisely the moment reserving credit has to work.
      const { readFileSync } = await import("node:fs");
      const fonte = readFileSync("src/lib/credits/pricing.ts", "utf8");
      const imports = [...fonte.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      expect(imports).toEqual(["@prisma/client", "./reasons"]);

      // Comments are stripped first. This module's own doc names the very
      // things it must not reach, and a scan that cannot tell prose from code
      // would fail on the explanation of why it passes.
      const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const proibido of ["fetch(", "secret-ref", "SecretRef", "providers/", "http"]) {
        expect(codigo).not.toContain(proibido);
      }
    });
  });

  // -------------------------------------------------------- inteiros e CHECKs

  describe("money is an integer number of cents", () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2500"])(
      "refuses %p as an amount, and writes nothing",
      async (valor) => {
        await conta();

        await expect(
          prisma.$transaction((tx) =>
            reserveCredits(tx, reserva({ amountCents: valor as number })),
          ),
        ).rejects.toMatchObject({ code: "VALOR_INVALIDO" });

        const depois = await prisma.creditAccount.findUniqueOrThrow({
          where: { organizationId: fx.organizationId },
        });
        expect(depois.reservedCents).toBe(0);
        expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      },
    );

    it("refuses a negative balance at the database, not just in code", async () => {
      await conta({ balanceCents: 1_000 });

      await expect(
        prisma.creditAccount.update({
          where: { organizationId: fx.organizationId },
          data: { balanceCents: -1 },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ["reservedCents", { reservedCents: -1 }],
      ["consumedThisMonthCents", { consumedThisMonthCents: -1 }],
    ])("refuses a negative %s at the database", async (_label, data) => {
      await conta();

      await expect(
        prisma.creditAccount.update({ where: { organizationId: fx.organizationId }, data }),
      ).rejects.toThrow();
    });

    it("refuses a reservation larger than the balance, at the database", async () => {
      // Available is `balance − reserved`. If reserved could exceed the balance,
      // available would go negative — an account owing money nobody put there.
      await conta({ balanceCents: 1_000, reservedCents: 0 });

      await expect(
        prisma.creditAccount.update({
          where: { organizationId: fx.organizationId },
          data: { reservedCents: 1_001 },
        }),
      ).rejects.toThrow();
    });

    it("refuses a price of zero, which is not the same as unset", async () => {
      await expect(conta({ generationPriceCents: 0 })).rejects.toThrow();
    });

    it("keeps the closed domains closed", async () => {
      await conta();
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      await expect(
        prisma.creditReservation.update({
          where: { id: r.id },
          data: { status: "ESTADO_INVENTADO" },
        }),
      ).rejects.toThrow();

      expect([...RESERVATION_STATUSES]).toEqual([
        "RESERVADA",
        "CONSUMIDA",
        "LIBERADA",
        "CONCILIACAO",
      ]);
      expect(LEDGER_MOVEMENTS).toContain("ROLLOVER");
    });
  });

  // ---------------------------------------------------------------- rollover

  describe("the month turning over", () => {
    it("zeroes what was consumed and leaves reservations alone", async () => {
      // A reservation alive across the boundary is still money committed.
      await conta({ consumedThisMonthCents: 40_000, reservedCents: 10_000 });
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month'
         WHERE "organizationId" = ${fx.organizationId}
      `;

      const { rolled } = await prisma.$transaction((tx) =>
        rolloverIfDue(tx, fx.organizationId),
      );

      expect(rolled).toBe(true);
      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.consumedThisMonthCents).toBe(0);
      expect(depois.reservedCents).toBe(10_000);
    });

    it("does nothing when the period is current", async () => {
      await conta({ consumedThisMonthCents: 40_000 });

      const { rolled } = await prisma.$transaction((tx) => rolloverIfDue(tx, fx.organizationId));

      expect(rolled).toBe(false);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
    });

    it("happens once under concurrency, with one ROLLOVER line", async () => {
      await conta({ consumedThisMonthCents: 40_000 });
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month'
         WHERE "organizationId" = ${fx.organizationId}
      `;

      const resultados = await Promise.all(
        Array.from({ length: 5 }, () =>
          prisma.$transaction((tx) => rolloverIfDue(tx, fx.organizationId)),
        ),
      );

      expect(resultados.filter((r) => r.rolled)).toHaveLength(1);
      expect(await prisma.creditLedgerEntry.count({ where: { movement: "ROLLOVER" } })).toBe(1);
    });

    it("is measured by the database's clock, not this process's", async () => {
      await conta({ consumedThisMonthCents: 40_000 });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));

      // Two months ahead here, but the account's period is current there.
      const { rolled } = await prisma.$transaction((tx) => rolloverIfDue(tx, fx.organizationId));

      expect(rolled).toBe(false);
    });

    it("runs before the reservation, so the cap is the new month's", async () => {
      // Consumed to the cap in the month that just ended. Without the rollover
      // first, this reservation would be refused for a month that is over.
      await conta({ consumedThisMonthCents: 100_000, monthlyCapCents: 100_000 });
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month'
         WHERE "organizationId" = ${fx.organizationId}
      `;

      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      expect(r.amountCents).toBe(PRECO);
      expect(await prisma.creditLedgerEntry.count({ where: { movement: "ROLLOVER" } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------- reserva

  describe("reserving commits money without spending it", () => {
    it("moves only `reservedCents`, and writes the three balances after", async () => {
      await conta();

      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.balanceCents).toBe(100_000);
      expect(depois.reservedCents).toBe(PRECO);
      expect(depois.consumedThisMonthCents).toBe(0);

      const linha = await prisma.creditLedgerEntry.findFirstOrThrow({
        where: { reservationId: r.id },
      });
      expect(linha.movement).toBe("RESERVA");
      // Reserving moves no balance; the "after" values carry the story.
      expect(linha.amountCents).toBe(0);
      expect(linha.balanceAfterCents).toBe(100_000);
      expect(linha.reservedAfterCents).toBe(PRECO);
      expect(linha.consumedAfterCents).toBe(0);
    });

    it("gives the reservation a deadline from the database", async () => {
      await conta();
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const [{ agora }] = await prisma.$queryRaw<Array<{ agora: Date }>>`SELECT NOW() AS "agora"`;
      const restante = r.expiresAt.getTime() - agora.getTime();
      expect(restante).toBeGreaterThan((RESERVATION_THRESHOLD_SECONDS - 60) * 1000);
    });

    it("refuses when available is short, and moves nothing", async () => {
      await conta({ balanceCents: 3_000, reservedCents: 1_000 });

      await expect(
        prisma.$transaction((tx) => reserveCredits(tx, reserva())),
      ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(1_000);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
    });

    it("refuses past the monthly cap, counting what is already committed", async () => {
      await conta({ consumedThisMonthCents: 90_000, reservedCents: 8_000, monthlyCapCents: 100_000 });

      await expect(
        prisma.$transaction((tx) => reserveCredits(tx, reserva())),
      ).rejects.toMatchObject({ code: "TETO_MENSAL_ATINGIDO" });
    });

    it("refuses on a blocked account", async () => {
      await conta({ blockedAt: new Date() });

      await expect(
        prisma.$transaction((tx) => reserveCredits(tx, reserva())),
      ).rejects.toMatchObject({ code: "CONTA_BLOQUEADA" });
    });

    it("lets N concurrent reservations through when there is room for N−1", async () => {
      // The account decides in one statement. A read-then-write would let both
      // see room for one.
      await conta({ balanceCents: 3 * PRECO, monthlyCapCents: 1_000_000 });

      const resultados = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          prisma.$transaction((tx) => reserveCredits(tx, reserva())),
        ),
      );

      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(3 * PRECO);
    });

    it("validates organization coherence in the service", async () => {
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, reserva({ generationRunId: fx.otherGenerationRunId })),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZACAO_DIVERGENTE" });

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(0);
    });
  });

  // ------------------------------------------------- operationKey e as três escritas

  describe("the same operationKey never charges twice", () => {
    it("refuses the second, and leaves the account exactly as it was", async () => {
      await conta();
      const params = reserva();
      await prisma.$transaction((tx) => reserveCredits(tx, params));

      const antes = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });

      await expect(
        prisma.$transaction((tx) => reserveCredits(tx, params)),
      ).rejects.toMatchObject({ code: "RESERVA_DUPLICADA" });

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      // The account movement of the failed attempt rolled back with it.
      expect(depois.reservedCents).toBe(antes.reservedCents);
      expect(await prisma.creditReservation.count({ where: { operationKey: params.operationKey } })).toBe(1);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(1);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(1);
    });

    it("holds under concurrency: one reservation, one line, one watcher", async () => {
      await conta();
      const params = reserva();

      const resultados = await Promise.allSettled(
        Array.from({ length: 4 }, () => prisma.$transaction((tx) => reserveCredits(tx, params))),
      );

      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(PRECO);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(1);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(1);
    });

    it("lets two organizations use the same operationKey", async () => {
      await conta();
      await conta({ organizationId: fx.otherOrganizationId });
      const key = `generation:${randomUUID()}`;

      await prisma.$transaction((tx) => reserveCredits(tx, reserva({ operationKey: key })));
      await prisma.$transaction((tx) =>
        reserveCredits(tx, reserva({ operationKey: key, organizationId: fx.otherOrganizationId })),
      );

      expect(await prisma.creditReservation.count({ where: { operationKey: key } })).toBe(2);
    });
  });

  describe("reservation, ledger and watcher are one transaction", () => {
    it("creates all three together", async () => {
      await conta();

      const r = await prisma.$transaction((tx) =>
        reserveCredits(tx, reserva({ generationRunId: fx.generationRunId })),
      );

      const vigia = await prisma.job.findFirstOrThrow({
        where: { kind: "credit.threshold", organizationId: fx.organizationId },
      });
      expect(vigia.idempotencyKey).toBe(`credit:${r.id}`);
      expect(JSON.parse(vigia.payloadJson)).toMatchObject({ reservationId: r.id });
      expect(await prisma.creditLedgerEntry.count({ where: { reservationId: r.id } })).toBe(1);
    });

    it("undoes everything when the watcher cannot be enqueued", async () => {
      // A reservation created without its watcher is exactly the reservation
      // that gets forgotten: money committed with no date to come back. If it
      // cannot be enqueued, the reservation must not exist either.
      await conta();
      const reservationId = randomUUID();

      await expect(
        prisma.$transaction(async (tx) => {
          const r = await reserveCredits(tx, reserva());
          // Simulates the third write failing, after the first two landed.
          await tx.$executeRaw`SELECT 1 / 0`;
          return r;
        }),
      ).rejects.toThrow();

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(0);
      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(0);
      void reservationId;
    });

    it("leaves UsageLedger untouched", async () => {
      // `UsageLedger` records execution; this records money. Reserving is not
      // executing — a run that never starts would otherwise leave a usage line
      // for something that never ran.
      await conta();
      const antes = await prisma.usageLedger.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } });

      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      expect(await prisma.usageLedger.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(antes);
    });
  });

  describe("every movement writes the three balances after it", () => {
    it("holds across a rollover and two reservations", async () => {
      await conta({ consumedThisMonthCents: 10_000 });
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month'
         WHERE "organizationId" = ${fx.organizationId}
      `;

      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const linhas = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { createdAt: "asc" },
      });
      expect(linhas.map((l) => l.movement)).toEqual(["ROLLOVER", "RESERVA", "RESERVA"]);

      const conta_ = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      const ultima = linhas.at(-1)!;
      // The last line's snapshot is the account as it stands.
      expect(ultima.balanceAfterCents).toBe(conta_.balanceCents);
      expect(ultima.reservedAfterCents).toBe(conta_.reservedCents);
      expect(ultima.consumedAfterCents).toBe(conta_.consumedThisMonthCents);

      for (const linha of linhas) {
        expect(linha.balanceAfterCents).toBeGreaterThanOrEqual(0);
        expect(linha.reservedAfterCents).toBeGreaterThanOrEqual(0);
        expect(linha.consumedAfterCents).toBeGreaterThanOrEqual(0);
        expect(linha.reasonCode).not.toContain(" ");
      }
    });
  });
});
