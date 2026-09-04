import type { Prisma } from "@prisma/client";

import { writeLedger, type LedgerWriter } from "./ledger";

/**
 * The month turning over.
 *
 * **Lazy, on write, not on a cron.** A month with no generation at all leaves
 * no debt behind, and there is no way to "miss" a turn because a scheduled job
 * failed — the turn happens the first time anyone touches the account in the
 * new period, which is exactly when it starts to matter.
 *
 * It resets `consumedThisMonthCents` and **does not touch `reservedCents`**. A
 * reservation alive across the boundary is still money committed; zeroing it
 * would make the account claim it has back something it has already promised.
 *
 * The condition is evaluated by PostgreSQL, against its own clock and in the
 * same statement that writes — so two concurrent reservations at 00:00 on the
 * first of the month produce one rollover, not two, and one `ROLLOVER` line.
 */
export type PeriodDb = LedgerWriter & Pick<Prisma.TransactionClient, "creditAccount" | "$queryRaw">;

type RolledAccount = {
  organizationId: string;
  balanceCents: number;
  reservedCents: number;
  consumedThisMonthCents: number;
};

/**
 * Advances the period if it is due, and returns whether it did.
 *
 * The caller is inside a transaction that is about to move money; this runs
 * first so the reservation it is about to make is measured against the new
 * period's consumption rather than the old one's.
 */
export async function rolloverIfDue(
  db: PeriodDb,
  organizationId: string,
): Promise<{ rolled: boolean }> {
  // `date_trunc('month', NOW())` is the start of the current period. A row
  // whose `periodStartedAt` is before it belongs to a month that has ended.
  //
  // The `UPDATE ... WHERE` is the decision: whoever matches it does the
  // rollover, and everyone else finds nothing to do — including a second
  // transaction that read the same stale `periodStartedAt` a millisecond
  // earlier, because it waits for the row lock and then re-evaluates.
  const rows = await db.$queryRaw<RolledAccount[]>`
    UPDATE "CreditAccount"
       SET "consumedThisMonthCents" = 0,
           "periodStartedAt" = date_trunc('month', NOW()),
           "updatedAt" = NOW()
     WHERE "organizationId" = ${organizationId}
       AND "periodStartedAt" < date_trunc('month', NOW())
    RETURNING "organizationId", "balanceCents", "reservedCents", "consumedThisMonthCents"
  `;

  const account = rows[0];
  if (!account) return { rolled: false };

  await writeLedger(db, {
    organizationId,
    movement: "ROLLOVER",
    // No money moved. The three "after" values carry the story.
    amountCents: 0,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode: "ROLLOVER_DE_PERIODO",
  });

  return { rolled: true };
}
