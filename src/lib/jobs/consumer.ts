import "server-only";

import { randomUUID } from "node:crypto";

import { claimJob, DEFAULT_LEASE_SECONDS } from "./claim";
import { extendLease, holdsLease } from "./heartbeat";
import { JOB_HANDLERS, type JobHandlers, type JobOutcome } from "./handlers";
import { isJobKind, type JobKind } from "./kinds";
import { reclaimExpiredLeases } from "./reconcile";
import {
  completeJob,
  deferJob,
  failJobPermanent,
  failJobRecoverable,
  pauseJob,
} from "./outcomes";
import { decodeJobPayload } from "./payload";
import { JobRefusal } from "./reasons";

/**
 * The consumer.
 *
 * Serverless does not sustain a live loop, so there is no worker: this is a
 * route with a budget that acquires **one job at a time, on demand**, runs it,
 * settles it, and asks for another until the budget runs out. Nothing waits
 * idle; a consumer with nothing to do returns immediately and costs nothing.
 *
 * Two properties hold by construction rather than by convention:
 *
 *   * **every claimed job is settled exactly once.** Handlers return an
 *     outcome; only this loop writes it. A handler that forgot to settle would
 *     otherwise leave its job `EM_EXECUCAO` until the lease lapsed, and the
 *     queue would look healthy for six minutes at a time.
 *
 *   * **a handler that throws does not end the cycle.** The failure settles
 *     that job and the loop moves to the next one. One bad job must not stop
 *     the queue for every tenant.
 */

/** Roughly what the shortest useful slice of work costs. */
const MIN_SLICE_MS = 2_000;

export type RunJobBatchParams = {
  /** Identifies this consumer for the lease. Defaults to a fresh id. */
  owner?: string;
  /**
   * Whose queue to work.
   *
   * Absent is the scheduler: one global consumer serving every tenant. Present
   * is a person asking for their own organization's queue to move, and it
   * narrows both the acquisition and the reclaim — a request from A must not
   * run B's job, nor resurrect B's stuck one.
   */
  organizationId?: string;
  /** How long this invocation may keep working. */
  budgetMs?: number;
  /** Injectable so commits 9 to 14 can register theirs, and tests theirs. */
  handlers?: JobHandlers;
  leaseSeconds?: number;
  /**
   * Milliseconds elapsed inside this invocation.
   *
   * Deliberately *not* the queue's clock question: this measures how long this
   * function has been running, which is the one thing the process itself is the
   * authority on. It defaults to a monotonic source so an NTP step mid-batch
   * cannot make the budget look spent — or infinite.
   */
  elapsedMs?: () => number;
};

export type JobBatchReport = {
  owner: string;
  /** Present only for a tenant-scoped run. */
  organizationId?: string;
  reclaimed: number;
  claimed: number;
  outcomes: Record<string, number>;
  stoppedBecause: "sem_trabalho" | "orcamento";
  elapsedMs: number;
};

function monotonic(): () => number {
  const started = performance.now();
  return () => performance.now() - started;
}

/**
 * Applies an outcome, and says whether it actually landed.
 *
 * Every settling function matches on the lease, so all of them return `null`
 * when this consumer no longer holds the job — reclaimed mid-handler, most
 * likely. That is not the outcome the handler asked for; it is no outcome at
 * all, and the report has to say so. Counting a `concluido` that wrote nothing
 * would put a completion in the log for a job that is, at that moment, back in
 * the queue for someone else to run.
 */
async function applyOutcome(
  outcome: JobOutcome,
  params: { jobId: string; owner: string; step: string },
): Promise<boolean> {
  const { jobId, owner, step } = params;

  switch (outcome.type) {
    case "concluido":
      return (await completeJob({ jobId, owner })) !== null;
    case "aguardar":
      return (await deferJob({ jobId, owner, delaySeconds: outcome.delaySeconds })) !== null;
    case "pausar":
      return (
        (await pauseJob({
          jobId,
          owner,
          reason: outcome.reason,
          retryAfterSeconds: outcome.retryAfterSeconds,
        })) !== null
      );
    case "falha_recuperavel":
      return (await failJobRecoverable({ jobId, owner, error: outcome.error, step })) !== null;
    case "falha_permanente":
      return (
        (await failJobPermanent({ jobId, owner, error: outcome.error, step, as: outcome.as })) !==
        null
      );
  }
}

export async function runJobBatch(params: RunJobBatchParams = {}): Promise<JobBatchReport> {
  const owner = params.owner ?? `consumidor-${randomUUID()}`;
  const budgetMs = params.budgetMs ?? 235_000;
  const handlers = params.handlers ?? JOB_HANDLERS;
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const elapsed = params.elapsedMs ?? monotonic();

  const report: JobBatchReport = {
    owner,
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    reclaimed: 0,
    claimed: 0,
    outcomes: {},
    stoppedBecause: "sem_trabalho",
    elapsedMs: 0,
  };

  const count = (type: string) => {
    report.outcomes[type] = (report.outcomes[type] ?? 0) + 1;
  };

  // Before anything else, and every cycle — not on a separate schedule.
  //
  // A job whose consumer was killed sits `EM_EXECUCAO` with a lapsed lease and
  // is invisible to `claimJob`. If reclaiming were a separate cron, or a button
  // someone remembers to press, that job would wait for it; the queue would
  // look stuck and the reason would be a second moving part. Doing it here
  // means the same invocation that finds nothing to do is the one that
  // discovers why.
  const reclaimed = await reclaimExpiredLeases({ organizationId: params.organizationId });
  report.reclaimed = reclaimed.length;

  while (true) {
    // Checked *before* claiming, never after. Acquiring a job we have no time
    // to run would park it under a lease for six minutes for nothing.
    if (elapsed() + MIN_SLICE_MS > budgetMs) {
      report.stoppedBecause = "orcamento";
      break;
    }

    const job = await claimJob({ owner, leaseSeconds, organizationId: params.organizationId });
    if (!job) {
      report.stoppedBecause = "sem_trabalho";
      break;
    }
    report.claimed += 1;

    const kind = job.kind;
    const handler = isJobKind(kind) ? handlers[kind as JobKind] : undefined;

    let outcome: JobOutcome;
    if (!handler) {
      // Not a retry: repeating does not make code appear that does not exist.
      outcome = {
        type: "falha_permanente",
        error: new JobRefusal("SEM_HANDLER", { kind: isJobKind(kind) ? kind : undefined }),
        as: "CONCILIACAO",
      };
    } else {
      try {
        outcome = await handler({
          job,
          payload: decodeJobPayload(job.payloadJson),
          owner,
          heartbeat: () => extendLease({ jobId: job.id, owner, leaseSeconds }),
          stillOurs: () => holdsLease({ jobId: job.id, owner }),
        });
      } catch (error) {
        // One bad job must not stop the queue for every tenant.
        outcome = { type: "falha_recuperavel", error };
      }
    }

    try {
      const wrote = await applyOutcome(outcome, { jobId: job.id, owner, step: kind });
      // What the handler decided is not what happened if the job was taken
      // away mid-run. Recording the requested outcome would put a completion
      // in the log for a job that is back in the queue.
      count(wrote ? outcome.type : "lease_perdido");
    } catch (error) {
      // Settling itself failed — the database, most likely. The lease lapses
      // and the reclaim brings the job back; nothing is lost, and pretending
      // otherwise by counting it would be worse than the gap.
      count("falha_ao_liquidar");
      void error;
    }
  }

  report.elapsedMs = Math.round(elapsed());
  return report;
}
