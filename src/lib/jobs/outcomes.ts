import "server-only";

import type { Job } from "@prisma/client";

import { prisma } from "@/lib/db";

import { backoffSeconds } from "./backoff";
import { describeJobError, formatStoredError } from "./error-record";
import { isJobKind, isPauseReason, type PauseReason } from "./kinds";
import { buildJobReasonMessage, JobRefusal } from "./reasons";

/**
 * The five ways a job stops running, and what each one counts.
 *
 * The distinction that matters is between **failing** and **waiting**. An agent
 * still generating, a check still queued, a preview still building — none of
 * those is a provider refusing. Counting them as attempts would walk a healthy
 * two-hour generation into its dead letter for the offence of taking two hours,
 * so waiting has its own counter, its own deadline, and no backoff.
 *
 *   `completeJob`         — done, terminal
 *   `deferJob`            — still waiting; counts `pollCount`, honours the deadline
 *   `pauseJob`            — the brake is on; counts nothing at all
 *   `failJobRecoverable`  — a real failure; counts `attempts`, applies backoff
 *   `failJobPermanent`    — will not be retried; terminal or under conciliation
 *
 * Every one of them clears the lease. A terminal status also frees the
 * `concurrencyKey`, because the partial unique index only covers live rows —
 * that is how the next generation of the same project becomes possible.
 */

export type OutcomeParams = {
  jobId: string;
  /** The consumer that holds the lease. A job is only ever settled by its holder. */
  owner: string;
};

type LockedJob = Job & { agora: Date };

/**
 * Locks the job, and reads the clock from the same place the row lives.
 *
 * Returns null when this consumer is not the holder — a lapsed consumer that
 * finished late must not settle a job someone else is now running. That is the
 * duplicate-effect hazard the lease exists to prevent, arriving one step later.
 */
async function lockOwnedJob(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: OutcomeParams,
): Promise<LockedJob | null> {
  const rows = await tx.$queryRaw<LockedJob[]>`
    SELECT j.*, NOW() AS "agora"
      FROM "Job" j
     WHERE j."id" = ${params.jobId}
       AND j."leaseOwner" = ${params.owner}
       AND j."status" = 'EM_EXECUCAO'
       AND j."leaseExpiresAt" > NOW()
     FOR UPDATE
  `;
  return rows[0] ?? null;
}

const RELEASED_LEASE = { leaseOwner: null, leaseExpiresAt: null } as const;

/** The step finished, and the chain moves on. */
export async function completeJob(params: OutcomeParams): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, params);
    if (!job) return null;

    return tx.job.update({
      where: { id: job.id },
      data: {
        status: "CONCLUIDO",
        finishedAt: job.agora,
        pausedReason: null,
        ...RELEASED_LEASE,
      },
    });
  });
}

export type DeferJobParams = OutcomeParams & {
  /** How long before looking again. */
  delaySeconds: number;
};

/**
 * Still waiting.
 *
 * Counts `pollCount`, never `attempts`, and applies no backoff of failure. If
 * `pollDeadlineAt` has passed, the job stops waiting and goes to `CONCILIACAO`
 * rather than to its dead letter: a generation that ran out of patience may
 * well have produced a remote effect, and a dead letter would quietly say the
 * opposite.
 */
export async function deferJob(params: DeferJobParams): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, params);
    if (!job) return null;

    const deadlineBlown =
      job.pollDeadlineAt !== null && job.pollDeadlineAt.getTime() <= job.agora.getTime();

    if (deadlineBlown) {
      const reason = "PRAZO_DE_ESPERA_ESTOURADO";
      return tx.job.update({
        where: { id: job.id },
        data: {
          status: "CONCILIACAO",
          pollCount: { increment: 1 },
          lastErrorCode: reason,
          // `job.kind` is a `string` on the way out of the database, and a
          // column is not a closed set. It gets the same check as anything else
          // before it reaches a message.
          lastError: buildJobReasonMessage(reason, {
            kind: isJobKind(job.kind) ? job.kind : undefined,
          }),
          ...RELEASED_LEASE,
        },
      });
    }

    return tx.job.update({
      where: { id: job.id },
      data: {
        status: "PENDENTE",
        pollCount: { increment: 1 },
        runAfter: new Date(job.agora.getTime() + params.delaySeconds * 1000),
        ...RELEASED_LEASE,
      },
    });
  });
}

export type PauseJobParams = OutcomeParams & {
  /** A closed code — the brake's reason, never a provider's words. */
  reason: PauseReason;
  /** When to look again. The brake gets to decide again, not to be remembered. */
  retryAfterSeconds: number;
};

/**
 * The brake is on.
 *
 * Counts nothing — not attempts, not polls. A job paused because the
 * integration is off has not failed and has not waited on a provider; it simply
 * was not allowed to run. It comes back on its own when `runAfter` passes, and
 * whoever set the brake gets asked again.
 */
export async function pauseJob(params: PauseJobParams): Promise<Job | null> {
  // Checked at runtime as well as in the type. `pausedReason` is a column, and
  // the one caller that will ever get this wrong is the one holding a string a
  // provider handed it.
  if (!isPauseReason(params.reason)) throw new JobRefusal("MOTIVO_DE_PAUSA_DESCONHECIDO");

  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, params);
    if (!job) return null;

    return tx.job.update({
      where: { id: job.id },
      data: {
        status: "PAUSADO",
        pausedReason: params.reason,
        runAfter: new Date(job.agora.getTime() + params.retryAfterSeconds * 1000),
        ...RELEASED_LEASE,
      },
    });
  });
}

export type FailJobParams = OutcomeParams & {
  error: unknown;
  /** Named for the log line only; never stored. */
  step?: string;
  random?: () => number;
};

/**
 * A real failure, worth trying again.
 *
 * The only outcome that increments `attempts`, and the only one that applies
 * backoff. When the attempts run out the job goes to `CARTA_MORTA` — terminal,
 * so the project is no longer blocked, and visible, so someone can reprocess it.
 */
export async function failJobRecoverable(params: FailJobParams): Promise<Job | null> {
  const stored = describeJobError(params.error, { step: params.step });

  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, params);
    if (!job) return null;

    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;
    const delay = backoffSeconds(job.attempts, params.random);

    return tx.job.update({
      where: { id: job.id },
      data: {
        attempts,
        status: exhausted ? "CARTA_MORTA" : "PENDENTE",
        runAfter: exhausted ? job.runAfter : new Date(job.agora.getTime() + delay * 1000),
        finishedAt: exhausted ? job.agora : null,
        lastError: formatStoredError(stored),
        lastErrorCode: stored.code,
        correlationId: stored.correlationId ?? null,
        ...RELEASED_LEASE,
      },
    });
  });
}

export type FailPermanentParams = FailJobParams & {
  /**
   * `FALHOU` when the failure is understood and final. `CONCILIACAO` when a
   * remote effect or a cost cannot be ruled out — that is not a failure to
   * report, it is work for a person.
   */
  as?: "FALHOU" | "CONCILIACAO";
};

/** Will not be retried, whatever attempts remain. */
export async function failJobPermanent(params: FailPermanentParams): Promise<Job | null> {
  const stored = describeJobError(params.error, { step: params.step });
  const status = params.as ?? "FALHOU";

  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, params);
    if (!job) return null;

    return tx.job.update({
      where: { id: job.id },
      data: {
        status,
        // Conciliation is not an ending: the job is still live work, and the
        // project stays blocked until a person resolves it.
        finishedAt: status === "FALHOU" ? job.agora : null,
        lastError: formatStoredError(stored),
        lastErrorCode: stored.code,
        correlationId: stored.correlationId ?? null,
        ...RELEASED_LEASE,
      },
    });
  });
}
