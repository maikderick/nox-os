import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { writeLedger } from "@/lib/credits/ledger";
import { ESTIMATED_BY } from "@/lib/credits/reasons";
import { reserveCredits } from "@/lib/credits/reserve";
import { enqueueJob } from "@/lib/jobs/outbox";

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
 * whole table instead, and a `kind` is not a scope either — the queue is global
 * by design, so `credit.threshold` names every organization's watchers. Either
 * way the assertion answers with whatever other suites left behind, and this
 * one would pass or fail depending on which files ran before it.
 */
describeLocalDatabase("credit invariants", () => {
  let fx: QueueFixture;
  let userDaOrg: string;
  let userDeFora: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const dentro = await prisma.user.create({
      data: {
        email: `dentro-${fx.token}@example.test`,
        name: "Dentro",
        passwordHash: "x",
        role: "admin",
      },
    });
    const fora = await prisma.user.create({
      data: {
        email: `fora-${fx.token}@example.test`,
        name: "Fora",
        passwordHash: "x",
        role: "admin",
      },
    });
    userDaOrg = dentro.id;
    userDeFora = fora.id;
    await prisma.organizationMembership.create({
      data: { organizationId: fx.organizationId, userId: dentro.id, role: "ADMIN" },
    });
    await prisma.organizationMembership.create({
      data: { organizationId: fx.otherOrganizationId, userId: fora.id, role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await prisma.organizationMembership.deleteMany({
      where: { userId: { in: [userDaOrg, userDeFora] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userDaOrg, userDeFora] } } });
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    const orgs = [fx.organizationId, fx.otherOrganizationId];
    await prisma.creditLedgerEntry.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.creditReservation.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.job.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.creditAccount.deleteMany({ where: { organizationId: { in: orgs } } });
  });

  async function conta(organizationId = fx.organizationId) {
    return prisma.creditAccount.create({
      data: {
        organizationId,
        balanceCents: 100_000,
        monthlyCapCents: 100_000,
        generationPriceCents: PRECO,
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

  // -------------------------------------------------- jobId é o próprio vigia

  describe("`jobId` names this reservation's watcher, and nothing else", () => {
    it("is filled from the job the reservation created", async () => {
      await conta();

      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const vigia = await prisma.job.findFirstOrThrow({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } });
      expect(r.jobId).toBe(vigia.id);
      expect(vigia.idempotencyKey).toBe(`credit:${r.id}`);
      expect(vigia.organizationId).toBe(fx.organizationId);
    });

    it("is not something a caller can supply", async () => {
      // It was an input, and an input meant a reservation could point at any
      // job at all — including another organization's — while the column looked
      // authoritative. The type no longer has the field.
      const params = reserva();
      expect(Object.keys(params)).not.toContain("jobId");
    });

    it("points at exactly one watcher, per reservation", async () => {
      await conta();

      const a = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      const b = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      expect(a.jobId).not.toBe(b.jobId);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(2);
    });
  });

  // ------------------------------------------- coerência de organização

  describe("belonging, not merely existing", () => {
    it("refuses a run of another organization", async () => {
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, reserva({ generationRunId: fx.otherGenerationRunId })),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZACAO_DIVERGENTE" });

      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.job.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
    });

    it("keeps account, reservation, run, watcher and ledger on one organization", async () => {
      await conta();

      const r = await prisma.$transaction((tx) =>
        reserveCredits(tx, reserva({ generationRunId: fx.generationRunId })),
      );

      const vigia = await prisma.job.findUniqueOrThrow({ where: { id: r.jobId! } });
      const linha = await prisma.creditLedgerEntry.findFirstOrThrow({
        where: { reservationId: r.id },
      });
      const run = await prisma.generationRun.findUniqueOrThrow({
        where: { id: fx.generationRunId },
        select: { siteProject: { select: { organizationId: true } } },
      });

      const orgs = new Set([
        r.organizationId,
        vigia.organizationId,
        linha.organizationId,
        run.siteProject.organizationId,
      ]);
      expect([...orgs]).toEqual([fx.organizationId]);
    });

    it("refuses a ledger line filed under the wrong organization", async () => {
      // The FK proves the reservation exists. It says nothing about whose it
      // is, and a line under A describing B's reservation is a number neither
      // organization can explain.
      await conta();
      await conta(fx.otherOrganizationId);
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      await expect(
        prisma.$transaction((tx) =>
          writeLedger(tx, {
            organizationId: fx.otherOrganizationId,
            movement: "AJUSTE",
            amountCents: 0,
            balanceAfterCents: 0,
            reservedAfterCents: 0,
            consumedAfterCents: 0,
            reasonCode: "RESERVA_DE_GERACAO",
            reservationId: r.id,
          }),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZACAO_DIVERGENTE" });

      expect(
        await prisma.creditLedgerEntry.count({ where: { organizationId: fx.otherOrganizationId } }),
      ).toBe(0);
    });

    it("refuses a ledger line whose actor belongs elsewhere", async () => {
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          writeLedger(tx, {
            organizationId: fx.organizationId,
            movement: "APORTE",
            amountCents: 1_000,
            balanceAfterCents: 101_000,
            reservedAfterCents: 0,
            consumedAfterCents: 0,
            reasonCode: "RESERVA_DE_GERACAO",
            actorId: userDeFora,
          }),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZACAO_DIVERGENTE" });
    });

    it("accepts an actor who is a member", async () => {
      await conta();

      const linha = await prisma.$transaction((tx) =>
        writeLedger(tx, {
          organizationId: fx.organizationId,
          movement: "APORTE",
          amountCents: 1_000,
          balanceAfterCents: 101_000,
          reservedAfterCents: 0,
          consumedAfterCents: 0,
          reasonCode: "RESERVA_DE_GERACAO",
          actorId: userDaOrg,
        }),
      );

      expect(linha.actorId).toBe(userDaOrg);
    });

    it("refuses a reservation whose watcher landed in another organization", async () => {
      // Reached by handing `reserveCredits` an enqueue that files the job
      // elsewhere. The service checks the job it got back rather than assuming
      // the one it asked for is the one it received.
      await conta();
      await conta(fx.otherOrganizationId);

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, {
            ...reserva(),
            enqueue: ((client, args) =>
              enqueueJob(client, {
                ...args,
                organizationId: fx.otherOrganizationId,
              })) as typeof enqueueJob,
          }),
        ),
      ).rejects.toMatchObject({ code: "ORGANIZACAO_DIVERGENTE" });

      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
    });
  });

  // ------------------------------------------- a terceira escrita falhando

  describe("when the watcher itself cannot be enqueued", () => {
    it("takes the account, the reservation and the ledger down with it", async () => {
      // The earlier version of this test let the enqueue succeed and then broke
      // something else — which proves a transaction rolls back, and proves
      // nothing about *this* write failing. Now the enqueue is the thing that
      // fails, and the transaction and the database are both real.
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, {
            ...reserva(),
            enqueue: async () => {
              throw new Error("a fila recusou o vigia");
            },
          }),
        ),
      ).rejects.toThrow("a fila recusou o vigia");

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(0);
      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(0);
    });

    it("does the same when the enqueue refuses rather than throws a raw error", async () => {
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, {
            ...reserva(),
            // A real refusal shape: the outbox rejecting an unknown kind.
            enqueue: ((client, args) =>
              enqueueJob(client, {
                ...args,
                step: { ...args.step, kind: "inexistente" } as never,
              })) as typeof enqueueJob,
          }),
        ),
      ).rejects.toMatchObject({ code: "TIPO_DESCONHECIDO" });

      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
      expect(await prisma.creditLedgerEntry.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(0);
    });
  });

  // ------------------------------------------------------- ordem do extrato

  describe("the ledger has a total, immutable order", () => {
    it("orders two lines written in one transaction", async () => {
      // `createdAt` cannot: `NOW()` is stable from BEGIN to COMMIT, so the
      // rollover and the reservation that triggered it carry the same instant.
      await conta();
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month',
               "consumedThisMonthCents" = 10000
         WHERE "organizationId" = ${fx.organizationId}
      `;

      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const linhas = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
      });
      expect(linhas.map((l) => l.movement)).toEqual(["ROLLOVER", "RESERVA"]);
      expect(linhas[1]!.seq).toBeGreaterThan(linhas[0]!.seq);
    });

    it("orders them even when the timestamps are identical", async () => {
      // `createdAt` is filled by Prisma on the client, so it is this process's
      // clock at millisecond resolution — it ties between fast writes, and it
      // walks backwards on an NTP step. Forcing the tie makes the point without
      // depending on how fast the machine happens to be: `seq` still orders.
      await conta();
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month',
               "consumedThisMonthCents" = 10000
         WHERE "organizationId" = ${fx.organizationId}
      `;
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const mesmoInstante = new Date();
      await prisma.creditLedgerEntry.updateMany({
        where: { organizationId: fx.organizationId },
        data: { createdAt: mesmoInstante },
      });

      const porSeq = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
      });
      expect(porSeq.map((l) => l.movement)).toEqual(["ROLLOVER", "RESERVA"]);
      expect(new Set(porSeq.map((l) => l.createdAt.getTime())).size).toBe(1);
    });

    it("keeps its order when the timestamps run backwards", async () => {
      // The failure no comparison of timestamps can survive: the clock steps
      // back between two writes, and the later line looks earlier.
      await conta();
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const [primeira, segunda] = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
      });
      await prisma.creditLedgerEntry.update({
        where: { id: segunda!.id },
        data: { createdAt: new Date(primeira!.createdAt.getTime() - 60_000) },
      });

      const porSeq = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { seq: "asc" },
      });
      expect(porSeq.map((l) => l.id)).toEqual([primeira!.id, segunda!.id]);

      const porData = await prisma.creditLedgerEntry.findMany({
        where: { organizationId: fx.organizationId },
        orderBy: { createdAt: "asc" },
      });
      // The order the extract would have shown, had it trusted the clock.
      expect(porData.map((l) => l.id)).toEqual([segunda!.id, primeira!.id]);
    });

    it("keeps rising across transactions, and never repeats", async () => {
      await conta();
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const seqs = (
        await prisma.creditLedgerEntry.findMany({
          where: { organizationId: fx.organizationId },
          orderBy: { seq: "asc" },
          select: { seq: true },
        })
      ).map((l) => l.seq);

      expect(new Set(seqs).size).toBe(seqs.length);
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
      }
    });

    it("refuses two lines claiming the same position", async () => {
      await conta();
      const linha = await prisma.$transaction((tx) =>
        writeLedger(tx, {
          organizationId: fx.organizationId,
          movement: "APORTE",
          amountCents: 1_000,
          balanceAfterCents: 101_000,
          reservedAfterCents: 0,
          consumedAfterCents: 0,
          reasonCode: "RESERVA_DE_GERACAO",
        }),
      );

      await expect(
        prisma.$executeRaw`
          INSERT INTO "CreditLedgerEntry"
            ("id","seq","organizationId","movement","amountCents",
             "balanceAfterCents","reservedAfterCents","consumedAfterCents","reasonCode","createdAt")
          VALUES (${randomUUID()}, ${linha.seq}, ${fx.organizationId}, 'AJUSTE', 0, 0, 0, 0, 'X', NOW())
        `,
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------- estimatedBy

  describe("`estimatedBy` is a closed domain", () => {
    it("refuses an unknown value in the service, before anything moves", async () => {
      await conta();

      await expect(
        prisma.$transaction((tx) =>
          reserveCredits(tx, reserva({ estimatedBy: "PALPITE" as never })),
        ),
      ).rejects.toMatchObject({ code: "VALOR_INVALIDO" });

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(0);
    });

    it("refuses an unknown value written from outside the service", async () => {
      // The CHECK guards the path the service does not own: a script, a
      // console, a data migration. That is where unfamiliar values arrive.
      await conta();

      await expect(
        prisma.creditReservation.create({
          data: {
            organizationId: fx.organizationId,
            operationKey: `generation:${randomUUID()}`,
            amountCents: PRECO,
            estimatedBy: "VINDO_DE_UM_SCRIPT",
            expiresAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it("accepts every value the closed set declares", async () => {
      await conta();
      for (const valor of ESTIMATED_BY) {
        const r = await prisma.$transaction((tx) =>
          reserveCredits(tx, reserva({ estimatedBy: valor })),
        );
        expect(r.estimatedBy).toBe(valor);
      }
    });
  });

  // ------------------------------------------------------- reconciledBy

  describe("`reconciledById` is a real relation", () => {
    it("links to the person who reconciled", async () => {
      await conta();
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const conciliada = await prisma.creditReservation.update({
        where: { id: r.id },
        data: {
          status: "CONCILIACAO",
          reconciledById: userDaOrg,
          reconciledAt: new Date(),
          reconciledCents: PRECO,
        },
        include: { reconciledBy: true },
      });

      expect(conciliada.reconciledBy?.id).toBe(userDaOrg);
    });

    it("refuses a person who does not exist", async () => {
      await conta();
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      await expect(
        prisma.creditReservation.update({
          where: { id: r.id },
          data: { reconciledById: "nao-existe" },
        }),
      ).rejects.toThrow();
    });

    it("keeps the reservation when the person is deleted", async () => {
      // `SetNull`, deliberately. Losing who reconciled is bad; losing the record
      // of the money is worse, and the audit line keeps the name anyway.
      await conta();
      const r = await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      const efemero = await prisma.user.create({
        data: {
          email: `efemero-${randomUUID()}@example.test`,
          name: "Efemero",
          passwordHash: "x",
          role: "admin",
        },
      });
      await prisma.creditReservation.update({
        where: { id: r.id },
        data: { reconciledById: efemero.id },
      });

      await prisma.user.delete({ where: { id: efemero.id } });

      const depois = await prisma.creditReservation.findUniqueOrThrow({ where: { id: r.id } });
      expect(depois.reconciledById).toBeNull();
      expect(depois.amountCents).toBe(PRECO);
    });
  });

  // ------------------------------------------------------- o que não mudou

  describe("what must not have changed", () => {
    it("still writes no UsageLedger", async () => {
      await conta();
      const antes = await prisma.usageLedger.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } });
      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));
      expect(await prisma.usageLedger.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(antes);
    });

    it("still leaves `reservedCents` alone across a rollover", async () => {
      await conta();
      await prisma.$executeRaw`
        UPDATE "CreditAccount"
           SET "reservedCents" = 10000,
               "periodStartedAt" = date_trunc('month', NOW()) - interval '1 month',
               "consumedThisMonthCents" = 20000
         WHERE "organizationId" = ${fx.organizationId}
      `;

      await prisma.$transaction((tx) => reserveCredits(tx, reserva()));

      const depois = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId: fx.organizationId },
      });
      expect(depois.reservedCents).toBe(10_000 + PRECO);
      expect(depois.consumedThisMonthCents).toBe(0);
    });

    it("is still atomic under concurrency, with one watcher each", async () => {
      await conta();
      const params = reserva();

      const resultados = await Promise.allSettled(
        Array.from({ length: 4 }, () => prisma.$transaction((tx) => reserveCredits(tx, params))),
      );

      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.creditReservation.count({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } })).toBe(1);
      expect(await prisma.job.count({ where: { kind: "credit.threshold", ...{ organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } } })).toBe(1);
      const r = await prisma.creditReservation.findFirstOrThrow({ where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } } });
      expect(r.jobId).not.toBeNull();
    });
  });
});
