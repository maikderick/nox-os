import { Prisma } from "@prisma/client";

import { enqueueJob, type JobTransaction } from "@/lib/jobs/outbox";

import { writeLedger } from "./ledger";
import { rolloverIfDue } from "./period";
import { assertAmountCents, assertEstimatedBy, CreditRefusal, type EstimatedBy } from "./reasons";

/**
 * Committing money before anything is spent.
 *
 * Three writes, one transaction, and none of them is optional:
 *
 *   1. the account moves — `reservedCents` goes up, and nothing else does;
 *   2. the reservation row exists, so there is a record of what was committed
 *      and for which operation;
 *   3. `credit.threshold` is enqueued, so something will eventually decide what
 *      becomes of it.
 *
 * The third is the one that looks skippable and is not. A reservation created
 * without its watcher is exactly the reservation that gets forgotten: money
 * committed with no date to come back. Enqueueing it afterwards would need a
 * second transaction, and between two transactions is where the process dies.
 *
 * `UsageLedger` is deliberately untouched. It records **execution**;
 * `CreditLedgerEntry` records **money**. Reserving is not executing — a run
 * that never starts would otherwise leave a usage line for something that never
 * ran.
 */

/** How long before the watcher first asks what became of this reservation. */
export const RESERVATION_THRESHOLD_SECONDS = 2 * 60 * 60;

export type ReserveParams = {
  organizationId: string;
  /** `generation:<generationRunId>`. One reservation per operation, ever. */
  operationKey: string;
  amountCents: number;
  estimatedBy: EstimatedBy;
  generationRunId?: string | null;

  /**
   * Injected only by tests, to make the third write fail on purpose.
   *
   * The alternative was a test that let the enqueue succeed and then broke
   * something else in the transaction — which proves the transaction rolls
   * back, and proves nothing about what happens when *this* write is the one
   * that fails.
   */
  enqueue?: typeof enqueueJob;
};

type MovedAccount = {
  balanceCents: number;
  reservedCents: number;
  consumedThisMonthCents: number;
  monthlyCapCents: number;
  blockedAt: Date | null;
};

/**
 * Reserves credit, or refuses with the reason it could not.
 *
 * Must be called inside a transaction — the same one that writes whatever fact
 * justifies the spend.
 */
export async function reserveCredits(tx: JobTransaction, params: ReserveParams) {
  assertAmountCents(params.amountCents);
  assertEstimatedBy(params.estimatedBy);

  // Checked here, before any money moves, rather than being left to the outbox
  // at the end. The outbox would catch it and the transaction would roll back,
  // so it is safe either way — but a refusal that arrives after the account has
  // been updated reads, in a log, as "the reservation happened and then
  // something went wrong", which is not what occurred.
  if (params.generationRunId) {
    const run = await tx.generationRun.findUnique({
      where: { id: params.generationRunId },
      select: { siteProject: { select: { organizationId: true } } },
    });
    if (!run || run.siteProject.organizationId !== params.organizationId) {
      throw new CreditRefusal("ORGANIZACAO_DIVERGENTE");
    }
  }

  // The period turns over first, in this same transaction, so the cap is
  // measured against the month we are actually in.
  await rolloverIfDue(tx, params.organizationId);

  // The account decides, in one statement. A read-then-write would let two
  // concurrent reservations both see room for one.
  const moved = await tx.$queryRaw<MovedAccount[]>`
    UPDATE "CreditAccount"
       SET "reservedCents" = "reservedCents" + ${params.amountCents},
           "updatedAt" = NOW()
     WHERE "organizationId" = ${params.organizationId}
       AND "blockedAt" IS NULL
       AND "balanceCents" - "reservedCents" >= ${params.amountCents}
       AND "consumedThisMonthCents" + "reservedCents" + ${params.amountCents} <= "monthlyCapCents"
    RETURNING "balanceCents", "reservedCents", "consumedThisMonthCents",
              "monthlyCapCents", "blockedAt"
  `;

  const account = moved[0];
  if (!account) throw await explainRefusal(tx, params);

  // Read before the insert, so the row is created with its real deadline and
  // the object handed back carries it. Setting a placeholder and updating it
  // afterwards left the returned value lying about when the reservation expires
  // — and the caller has no reason to suspect a value it was just given.
  const [{ vence }] = await tx.$queryRaw<Array<{ vence: Date }>>`
    SELECT NOW() + make_interval(secs => ${RESERVATION_THRESHOLD_SECONDS}::double precision) AS "vence"
  `;

  let reservation;
  try {
    reservation = await tx.creditReservation.create({
      data: {
        organizationId: params.organizationId,
        operationKey: params.operationKey,
        amountCents: params.amountCents,
        estimatedBy: params.estimatedBy,
        generationRunId: params.generationRunId ?? null,
        expiresAt: vence,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // The same operation reserving twice. The index is what decides, and the
      // whole transaction rolls back — including the account movement above.
      throw new CreditRefusal("RESERVA_DUPLICADA");
    }
    throw error;
  }

  await writeLedger(tx, {
    organizationId: params.organizationId,
    movement: "RESERVA",
    // Reserving moves no balance. The three "after" values carry the story.
    amountCents: 0,
    balanceAfterCents: account.balanceCents,
    reservedAfterCents: account.reservedCents,
    consumedAfterCents: account.consumedThisMonthCents,
    reasonCode: "RESERVA_DE_GERACAO",
    reservationId: reservation.id,
  });

  // Born with its watcher, in the same transaction. A reservation without one
  // is money committed with no date to come back.
  const enqueue = params.enqueue ?? enqueueJob;
  const watcher = await enqueue(tx, {
    organizationId: params.organizationId,
    step: { kind: "credit.threshold", reservationId: reservation.id },
    payload: { reservationId: reservation.id },
    ...(params.generationRunId ? { generationRunId: params.generationRunId } : {}),
  });

  // `jobId` is not an input. It names **this** reservation's watcher, and there
  // is exactly one — so it is read off the job that was just created rather
  // than accepted from a caller. Letting a caller pass one meant a reservation
  // could point at any job at all, including another organization's, and the
  // column would look authoritative while meaning nothing.
  if (watcher.organizationId !== params.organizationId) {
    throw new CreditRefusal("ORGANIZACAO_DIVERGENTE");
  }

  return tx.creditReservation.update({
    where: { id: reservation.id },
    data: { jobId: watcher.id },
  });
}

/**
 * Why the conditional update matched nothing.
 *
 * Asked only after the fact, and only to produce a sentence: the decision was
 * already made by the database. Reading the account here cannot "disagree" with
 * anything, because nothing was written.
 */
async function explainRefusal(
  tx: JobTransaction,
  params: ReserveParams,
): Promise<CreditRefusal> {
  const account = await tx.creditAccount.findUnique({
    where: { organizationId: params.organizationId },
    select: {
      balanceCents: true,
      reservedCents: true,
      consumedThisMonthCents: true,
      monthlyCapCents: true,
      blockedAt: true,
    },
  });

  if (!account) return new CreditRefusal("CONTA_NAO_ENCONTRADA");
  if (account.blockedAt) return new CreditRefusal("CONTA_BLOQUEADA");

  const available = account.balanceCents - account.reservedCents;
  if (available < params.amountCents) {
    return new CreditRefusal("SALDO_INSUFICIENTE", {
      amountCents: params.amountCents,
      availableCents: available,
    });
  }

  return new CreditRefusal("TETO_MENSAL_ATINGIDO");
}
