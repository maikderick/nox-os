import type { Prisma } from "@prisma/client";

import { CreditRefusal, type CreditReason, type LedgerMovement } from "./reasons";

/**
 * Every movement of money, with the three balances as they stood afterwards.
 *
 * Writing the "after" values on each line is what makes a balance
 * reconstructible without replaying the whole series, and what makes a
 * discrepancy point at the exact line where it appeared. A ledger that only
 * records deltas answers "how much moved"; this one answers "and what was the
 * account then", which is the question an audit actually asks.
 *
 * Order comes from `seq`, never from `createdAt`. Prisma fills `@default(now())`
 * on the client — the value travels as an INSERT parameter and the column's
 * `DEFAULT CURRENT_TIMESTAMP` is never reached — so `createdAt` is this
 * process's clock, at millisecond resolution: it ties between fast writes, and
 * it walks backwards on an NTP step. No ordering survives a clock that goes
 * back. `seq` is assigned by the database, on write.
 *
 * There is no `db` default on purpose: a ledger line written outside the
 * transaction that moved the money is a line that can survive a rollback, and a
 * ledger nobody can trust is worse than none.
 */
export type LedgerWriter = Pick<
  Prisma.TransactionClient,
  "creditLedgerEntry" | "creditReservation" | "organizationMembership"
>;

export type LedgerLine = {
  organizationId: string;
  movement: LedgerMovement;
  /** Signed. A reservation moves no balance and records zero. */
  amountCents: number;
  balanceAfterCents: number;
  reservedAfterCents: number;
  consumedAfterCents: number;
  reasonCode:
    | CreditReason
    | "ROLLOVER_DE_PERIODO"
    | "RESERVA_DE_GERACAO"
    | "CONSUMO_DE_GERACAO"
    | "LIBERACAO_DE_RESERVA";
  reservationId?: string | null;
  actorId?: string | null;
};

/**
 * Writes one line, after checking that everything on it belongs together.
 *
 * The foreign keys prove the rows exist. They say nothing about **whose** they
 * are, and a ledger line is the one place where that difference is the whole
 * point: a line filed under organization A describing A's reservation is an
 * audit trail; the same line pointing at B's reservation is a number that
 * cannot be explained by anything either organization can see.
 *
 * Both checks read rather than trust. A caller that already knows the answer
 * pays one indexed lookup; a caller that got it wrong is stopped before the row
 * exists.
 */
export async function writeLedger(db: LedgerWriter, line: LedgerLine) {
  if (line.reservationId) {
    const reservation = await db.creditReservation.findUnique({
      where: { id: line.reservationId },
      select: { organizationId: true },
    });
    if (!reservation || reservation.organizationId !== line.organizationId) {
      throw new CreditRefusal("ORGANIZACAO_DIVERGENTE");
    }
  }

  if (line.actorId) {
    // An actor on a money line is a person who made a decision about this
    // organization's money. Someone from another organization cannot have.
    const membership = await db.organizationMembership.findFirst({
      where: { userId: line.actorId, organizationId: line.organizationId },
      select: { id: true },
    });
    if (!membership) throw new CreditRefusal("ORGANIZACAO_DIVERGENTE");
  }

  return db.creditLedgerEntry.create({
    data: {
      organizationId: line.organizationId,
      movement: line.movement,
      amountCents: line.amountCents,
      balanceAfterCents: line.balanceAfterCents,
      reservedAfterCents: line.reservedAfterCents,
      consumedAfterCents: line.consumedAfterCents,
      reasonCode: line.reasonCode,
      reservationId: line.reservationId ?? null,
      actorId: line.actorId ?? null,
    },
  });
}
