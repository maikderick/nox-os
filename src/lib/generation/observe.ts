import "server-only";

import { conciliateReservation, consumeReservation } from "@/lib/credits/settle";
import type { JobTransaction } from "@/lib/jobs/outbox";
import { applySystemTransition } from "@/lib/site-factory/system-transition";

import { evaluateGenerationOutcome, type BarrierDecision } from "./barrier";

/**
 * What both observers do once they have written their fact.
 *
 * Shared because it has to be *identical*: the two are siblings, either may be
 * the last to arrive, and the whole design rests on the last one closing the
 * generation. Two copies of this that drifted apart would mean the outcome
 * depended on which sibling finished last, which is precisely the thing nobody
 * controls.
 *
 * Everything below runs in the transaction that wrote the fact.
 */

/**
 * Serialises the two observers on the run they are both about.
 *
 * Without this, "whoever arrives last closes the generation" is simply not
 * true. Each observer writes its fact in its own transaction, and at READ
 * COMMITTED neither can see the other's uncommitted row — so two siblings
 * finishing in the same instant both read **two** facts, both decide
 * `AGUARDANDO`, and the generation is never closed by anyone. The project sits
 * in `GERANDO` with every fact present and nothing left to run.
 *
 * Locking the run makes the second one wait for the first to commit and then
 * read a world that contains its sibling's fact. It is the same lock the queue
 * uses on a job, for the same reason: the decision and the write have to see
 * the same state.
 *
 * The lock is taken **before** the facts are read, and released by the
 * transaction that wrote the fact — so it is held for one short transaction,
 * per run, and two different generations never contend.
 */
async function lockRun(tx: JobTransaction, generationRunId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "GenerationRun" WHERE "id" = ${generationRunId} FOR UPDATE
  `;
  return rows.length > 0;
}

/** The three facts, read fresh inside the settling transaction. */
async function readFacts(
  tx: JobTransaction,
  params: { generationRunId: string; requiredCheck: string },
) {
  const run = await tx.generationRun.findUnique({
    where: { id: params.generationRunId },
    select: {
      status: true,
      siteProjectId: true,
      revision: { select: { id: true, commitSha: true } },
    },
  });
  if (!run) return null;

  const siteRevisionId = run.revision?.id ?? null;

  const check = siteRevisionId
    ? await tx.generationCheck.findUnique({
        where: {
          siteRevisionId_name: { siteRevisionId, name: params.requiredCheck },
        },
        select: { siteRevisionId: true, commitSha: true, name: true, conclusion: true },
      })
    : null;

  const preview = siteRevisionId
    ? await tx.deployment.findFirst({
        where: { siteRevisionId, environment: "PREVIA" },
        orderBy: { createdAt: "desc" },
        select: { siteRevisionId: true, commitSha: true, status: true },
      })
    : null;

  return {
    siteProjectId: run.siteProjectId,
    input: {
      run: {
        status: run.status,
        siteRevisionId,
        commitSha: run.revision?.commitSha ?? null,
      },
      check,
      preview,
      requiredCheck: params.requiredCheck,
    },
  };
}

export type SettleResult = {
  decision: BarrierDecision;
  /** True only for the observer whose conditional update matched a row. */
  applied: boolean;
};

/**
 * Asks the barrier, and applies what it decided — conditionally.
 *
 * The conditional update is the whole race. Both siblings can read three
 * complete facts in the same instant; only one of them finds the project still
 * `GERANDO` when it writes. The loser re-reads, sees a terminal state, and
 * writes nothing — not the transition, not the audit line, not the settlement.
 */
export async function settleGeneration(
  tx: JobTransaction,
  params: { generationRunId: string; requiredCheck: string },
): Promise<SettleResult> {
  // Taken first, so the sibling that arrives a moment later reads a world that
  // already contains this one's fact instead of missing it.
  await lockRun(tx, params.generationRunId);

  const facts = await readFacts(tx, params);
  if (!facts) {
    return { decision: { outcome: "AGUARDANDO", reason: "FATOS_INCOMPLETOS" }, applied: false };
  }

  const decision = evaluateGenerationOutcome(facts.input);
  if (decision.outcome === "AGUARDANDO") return { decision, applied: false };

  const transition = await applySystemTransition(tx, {
    siteProjectId: facts.siteProjectId,
    from: "GERANDO",
    to: decision.outcome,
    reasonCode: decision.reason,
  });

  if (!transition.applied) return { decision, applied: false };

  // From here on, this transaction is the one that closed the generation.

  // The work was done and it is paid for, whichever way the barrier decided. A
  // failed check does not make the agent's run free — it happened, and the
  // ledger has to say so.
  const reservation = await tx.creditReservation.findUnique({
    where: { generationRunId: params.generationRunId },
    select: { id: true, status: true, amountCents: true },
  });
  if (reservation?.status === "RESERVADA") {
    await consumeReservation(tx, {
      reservationId: reservation.id,
      actualCents: reservation.amountCents,
    });
  }

  if (decision.outcome === "FALHOU") {
    // A terminal failure cancels the sibling that is still alive, in this same
    // transaction. Leaving it running would have it finish later, find
    // `FALHOU` where it needs `GERANDO`, and write nothing — correct, but it
    // would keep polling a preview nobody is waiting for until its deadline.
    await tx.job.updateMany({
      where: {
        generationRunId: params.generationRunId,
        kind: { in: ["checks.poll", "preview.poll"] },
        status: { in: ["PENDENTE", "PAUSADO"] },
      },
      data: {
        status: "CONCLUIDO",
        finishedAt: new Date(),
        lastErrorCode: decision.reason,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  return { decision, applied: true };
}

/**
 * The generation ran out of patience.
 *
 * Not a failure and not a success: nobody can say any more whether the remote
 * side is working or gone. The reservation goes to conciliation with the
 * account blocked, and the project stays `GERANDO` — moving it would claim an
 * outcome that was never established.
 */
export async function conciliateGeneration(
  tx: JobTransaction,
  params: { generationRunId: string },
): Promise<void> {
  const reservation = await tx.creditReservation.findUnique({
    where: { generationRunId: params.generationRunId },
    select: { id: true, status: true },
  });
  if (reservation?.status === "RESERVADA") {
    await conciliateReservation(tx, {
      reservationId: reservation.id,
      reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
    });
  }
}
