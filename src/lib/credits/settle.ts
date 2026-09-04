import "server-only";

import type { CreditReservation } from "@prisma/client";

import type { JobTransaction } from "@/lib/jobs/outbox";

import { writeLedger } from "./ledger";
import { assertAmountCents, CreditRefusal } from "./reasons";

/**
 * The three ways a reservation stops being live.
 *
 * A reservation is a promise about money that has not moved yet. Exactly one of
 * these ends it — consumed, released, or handed to a person — and every path
 * out of a generation reaches one of them. That is the whole contract of the
 * outcome table: no exit leaves money committed with nobody coming back for it.
 *
 * Two rules run through all three.
 *
 * **The account moves in one statement, conditioned on the invariant it must
 * not break.** `CreditAccount` carries a CHECK that forbids a negative balance
 * and forbids `reservedCents` exceeding `balanceCents`. Reading the account,
 * deciding in TypeScript and then writing would let two concurrent settlements
 * both see room; and when the condition does fail, the CHECK aborts the whole
 * transaction rather than returning an answer this code can act on. So the
 * condition is written into the `WHERE`, and "no rows" is a decision, not an
 * error.
 *
 * **The reservation is locked first, and only `RESERVADA` may be settled.**
 * A reservation settled twice would move the account twice for one promise.
 * `FOR UPDATE` plus the status check makes the second caller wait and then find
 * a status it may not act on.
 */

/** The account as it stood after the statement that moved it. */
type MovedAccount = {
  balanceCents: number;
  reservedCents: number;
  consumedThisMonthCents: number;
};

type LiveReservation = {
  id: string;
  organizationId: string;
  amountCents: number;
  generationRunId: string | null;
};

export type ConciliationSettlement = "CONSUMIR" | "LIBERAR";

/**
 * Locks the reservation and refuses anything that is not still live.
 *
 * `FOR UPDATE` rather than an optimistic read: the loser of a race has to
 * *wait* and then see the winner's status, not read the old one and decide from
 * it.
 */
async function lockLiveReservation(
  tx: JobTransaction,
  reservationId: string,
): Promise<LiveReservation> {
  const rows = await tx.$queryRaw<LiveReservation[]>`
    SELECT "id", "organizationId", "amountCents", "generationRunId"
      FROM "CreditReservation"
     WHERE "id" = ${reservationId}
       AND "status" = 'RESERVADA'
     FOR UPDATE
  `;

  const reservation = rows[0];
  if (!reservation) throw new CreditRefusal("RESERVA_NAO_LIQUIDAVEL");
  return reservation;
}

/** Reads the account for the message only — the decision was already made. */
async function accountSnapshot(tx: JobTransaction, organizationId: string) {
  const account = await tx.creditAccount.findUnique({
    where: { organizationId },
    select: {
      balanceCents: true,
      reservedCents: true,
      consumedThisMonthCents: true,
      blockedAt: true,
    },
  });
  if (!account) throw new CreditRefusal("CONTA_NAO_ENCONTRADA");
  return account;
}

export type ConsumeParams = {
  reservationId: string;
  /**
   * What it actually cost.
   *
   * Usually the reserved amount — in `FALSO` and `SANDBOX` it always is, and
   * that is on purpose: a mode that did not charge would leave a reconciliation
   * with nothing to compare against the day the mode changes.
   */
  actualCents: number;
  actorId?: string | null;
};

/**
 * The work happened and it is paid for.
 *
 * `reserved` gives back what was promised, `balance` gives up what was spent,
 * and `consumed` records it against the month. All three in one statement,
 * conditioned so the account cannot end up negative or over-reserved.
 *
 * **A real cost above the reservation with no room does not throw.** It blocks
 * the account and sends the reservation to conciliation, because the two
 * alternatives are both worse: charging what is not there breaks the invariant,
 * and charging only the reserved amount silently writes off the difference on a
 * ledger whose entire purpose is that nothing is written off silently.
 */
export async function consumeReservation(
  tx: JobTransaction,
  params: ConsumeParams,
): Promise<CreditReservation> {
  assertAmountCents(params.actualCents);
  const reservation = await lockLiveReservation(tx, params.reservationId);

  const moved = await tx.$queryRaw<MovedAccount[]>`
    UPDATE "CreditAccount"
       SET "reservedCents" = "reservedCents" - ${reservation.amountCents},
           "balanceCents" = "balanceCents" - ${params.actualCents},
           "consumedThisMonthCents" = "consumedThisMonthCents" + ${params.actualCents},
           "updatedAt" = NOW()
     WHERE "organizationId" = ${reservation.organizationId}
       AND "blockedAt" IS NULL
       AND "reservedCents" >= ${reservation.amountCents}
       AND "balanceCents" - ${params.actualCents} >= 0
       AND "reservedCents" - ${reservation.amountCents} <= "balanceCents" - ${params.actualCents}
    RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents"
  `;

  const account = moved[0];
  if (!account) {
    // Nothing moved, so nothing has to be undone. The difference between what
    // was promised and what it cost is now a person's decision.
    const before = await accountSnapshot(tx, reservation.organizationId);
    return blockAndConciliate(tx, {
      reservation,
      reasonCode: "CUSTO_ACIMA_DA_RESERVA",
      actorId: params.actorId ?? null,
      details: {
        amountCents: params.actualCents,
        availableCents: before.balanceCents,
      },
    });
  }

  await writeLedger(tx, {
    organizationId: reservation.organizationId,
    movement: "CONSUMO",
    // Signed: money left the account.
    amountCents: -params.actualCents,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode: "CONSUMO_DE_GERACAO",
    reservationId: reservation.id,
    actorId: params.actorId ?? null,
  });

  return tx.creditReservation.update({
    where: { id: reservation.id },
    data: { status: "CONSUMIDA", reconciledCents: params.actualCents },
  });
}

export type ReleaseParams = {
  reservationId: string;
  actorId?: string | null;
};

/**
 * Nothing was spent, and the promise is withdrawn.
 *
 * Only ever called where it is *proved* that no paid call happened —
 * `NAO_TENTADO` and `SEM_EFEITO_COMPROVADO`. Releasing on any other disposition
 * would be refunding work that may well have occurred.
 *
 * `reserved` comes back and `balance` does not move, which restores both
 * numbers a caller cares about at once: available (`balance − reserved`) and
 * exposure to the cap (`consumed + reserved`).
 */
export async function releaseReservation(
  tx: JobTransaction,
  params: ReleaseParams,
): Promise<CreditReservation> {
  const reservation = await lockLiveReservation(tx, params.reservationId);

  const moved = await tx.$queryRaw<MovedAccount[]>`
    UPDATE "CreditAccount"
       SET "reservedCents" = "reservedCents" - ${reservation.amountCents},
           "updatedAt" = NOW()
     WHERE "organizationId" = ${reservation.organizationId}
       AND "reservedCents" >= ${reservation.amountCents}
    RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents"
  `;

  const account = moved[0];
  // Only reachable if the account and its reservations disagree about how much
  // is committed, which is a broken invariant rather than an outcome.
  if (!account) throw new CreditRefusal("RESERVA_NAO_LIQUIDAVEL");

  await writeLedger(tx, {
    organizationId: reservation.organizationId,
    movement: "LIBERACAO",
    // Releasing moves no balance. The three "after" values carry the story,
    // exactly as they do for a reservation.
    amountCents: 0,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode: "LIBERACAO_DE_RESERVA",
    reservationId: reservation.id,
    actorId: params.actorId ?? null,
  });

  return tx.creditReservation.update({
    where: { id: reservation.id },
    data: { status: "LIBERADA" },
  });
}

/** Why a reservation was handed to a person. Closed, and it lands in a column. */
export type ConciliationReason = "CUSTO_ACIMA_DA_RESERVA" | "EFEITO_AMBIGUO_NA_GERACAO";

export type ConciliateParams = {
  reservationId: string;
  reasonCode: ConciliationReason;
  actorId?: string | null;
};

/**
 * Nobody can say what happened, so nobody decides automatically.
 *
 * The money stays committed — `reservedCents` is deliberately **not** returned
 * — and the account is blocked so no further generation adds to a total that is
 * already in question. Both are reversible by a person, which is the point:
 * this is the one outcome that is explicitly not a decision.
 */
export async function conciliateReservation(
  tx: JobTransaction,
  params: ConciliateParams,
): Promise<CreditReservation> {
  const reservation = await lockLiveReservation(tx, params.reservationId);
  return blockAndConciliate(tx, {
    reservation,
    reasonCode: params.reasonCode,
    actorId: params.actorId ?? null,
  });
}

/**
 * Settles a reservation that a previous ambiguous outcome handed to a person.
 *
 * This is deliberately separate from `consumeReservation` and
 * `releaseReservation`: those only accept `RESERVADA`, while this entrance only
 * accepts `CONCILIACAO`. Mixing both states in the automatic functions would
 * let ordinary worker code resolve an administrative hold by accident.
 */
export async function settleConciliatedReservation(
  tx: JobTransaction,
  params: {
    reservationId: string;
    settlement: ConciliationSettlement;
    actorId: string;
  },
): Promise<CreditReservation> {
  const rows = await tx.$queryRaw<LiveReservation[]>`
    SELECT "id", "organizationId", "amountCents", "generationRunId"
      FROM "CreditReservation"
     WHERE "id" = ${params.reservationId}
       AND "status" = 'CONCILIACAO'
     FOR UPDATE
  `;
  const reservation = rows[0];
  if (!reservation) throw new CreditRefusal("RESERVA_NAO_LIQUIDAVEL");

  const moved =
    params.settlement === "CONSUMIR"
      ? await tx.$queryRaw<MovedAccount[]>`
          UPDATE "CreditAccount"
             SET "reservedCents" = "reservedCents" - ${reservation.amountCents},
                 "balanceCents" = "balanceCents" - ${reservation.amountCents},
                 "consumedThisMonthCents" = "consumedThisMonthCents" + ${reservation.amountCents},
                 "updatedAt" = NOW()
           WHERE "organizationId" = ${reservation.organizationId}
             AND "reservedCents" >= ${reservation.amountCents}
             AND "balanceCents" >= ${reservation.amountCents}
          RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents"
        `
      : await tx.$queryRaw<MovedAccount[]>`
          UPDATE "CreditAccount"
             SET "reservedCents" = "reservedCents" - ${reservation.amountCents},
                 "updatedAt" = NOW()
           WHERE "organizationId" = ${reservation.organizationId}
             AND "reservedCents" >= ${reservation.amountCents}
          RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents"
        `;

  const account = moved[0];
  if (!account) throw new CreditRefusal("RESERVA_NAO_LIQUIDAVEL");

  await writeLedger(tx, {
    organizationId: reservation.organizationId,
    movement: params.settlement === "CONSUMIR" ? "CONSUMO" : "LIBERACAO",
    amountCents: params.settlement === "CONSUMIR" ? -reservation.amountCents : 0,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode:
      params.settlement === "CONSUMIR" ? "CONSUMO_DE_GERACAO" : "LIBERACAO_DE_RESERVA",
    reservationId: reservation.id,
    actorId: params.actorId,
  });

  const settled = await tx.creditReservation.update({
    where: { id: reservation.id },
    data: {
      status: params.settlement === "CONSUMIR" ? "CONSUMIDA" : "LIBERADA",
      reconciledCents: params.settlement === "CONSUMIR" ? reservation.amountCents : 0,
      reconciledById: params.actorId,
      reconciledAt: new Date(),
    },
  });

  // The account may have more than one administrative hold. It becomes usable
  // only after the last one is gone; resolving one must not hide another.
  const remaining = await tx.creditReservation.count({
    where: { organizationId: reservation.organizationId, status: "CONCILIACAO" },
  });
  if (remaining === 0) {
    await tx.creditAccount.updateMany({
      where: { organizationId: reservation.organizationId, blockedAt: { not: null } },
      data: { blockedAt: null, blockedReasonCode: null },
    });
  }

  return settled;
}

async function blockAndConciliate(
  tx: JobTransaction,
  params: {
    reservation: LiveReservation;
    reasonCode: ConciliationReason;
    actorId: string | null;
    details?: { amountCents?: number; availableCents?: number };
  },
): Promise<CreditReservation> {
  const { reservation } = params;

  // Blocking is idempotent on purpose: a second ambiguous generation on an
  // already-blocked account must not move `blockedAt` forward, because that
  // timestamp is when the trouble started.
  const blocked = await tx.$queryRaw<MovedAccount[]>`
    UPDATE "CreditAccount"
       SET "blockedAt" = COALESCE("blockedAt", NOW()),
           "blockedReasonCode" = COALESCE("blockedReasonCode", ${params.reasonCode}),
           "updatedAt" = NOW()
     WHERE "organizationId" = ${reservation.organizationId}
    RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents"
  `;

  const account = blocked[0];
  if (!account) throw new CreditRefusal("CONTA_NAO_ENCONTRADA");

  await writeLedger(tx, {
    organizationId: reservation.organizationId,
    movement: "BLOQUEIO",
    // No money moved. What changed is that none may move until a person says so.
    amountCents: 0,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode: params.reasonCode,
    reservationId: reservation.id,
    actorId: params.actorId,
  });

  return tx.creditReservation.update({
    where: { id: reservation.id },
    data: { status: "CONCILIACAO" },
  });
}
