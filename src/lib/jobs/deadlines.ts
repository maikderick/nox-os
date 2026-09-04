import { type JobKind } from "./kinds";

/**
 * How long a step is allowed to *wait*, per kind.
 *
 * Not how long it may take to fail — that is `maxAttempts` and the backoff.
 * This is the patience budget: an agent generating, a check queued, a preview
 * building. Running out of it is not a failure either; it means nobody can say
 * any more whether the remote side is working or gone, which is `CONCILIACAO`.
 *
 * The numbers are fixed here rather than passed in by each caller so that a job
 * restarted months later gets the same patience as one enqueued today. A
 * deadline that varies by call site is a deadline nobody can reason about.
 */
export const POLL_DEADLINE_SECONDS: Record<JobKind, number | null> = {
  /** Does not wait: it reserves, calls, and hands off. */
  "generation.start": null,
  /** The agent. Two hours, the longest patience in the phase. */
  "generation.poll": 2 * 60 * 60,
  /** A CI check. Thirty minutes. */
  "checks.poll": 30 * 60,
  /** A preview deployment. Thirty minutes. */
  "preview.poll": 30 * 60,
  /** Does not wait: it wakes on its own schedule and decides. */
  "credit.threshold": null,
};

export function pollDeadlineSecondsFor(kind: JobKind): number | null {
  return POLL_DEADLINE_SECONDS[kind];
}

/** Whether this kind waits on something outside itself. */
export function isPollingKind(kind: JobKind): boolean {
  return POLL_DEADLINE_SECONDS[kind] !== null;
}
