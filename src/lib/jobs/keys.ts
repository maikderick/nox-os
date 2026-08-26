import { isMutatingKind, type JobKind } from "./kinds";

/**
 * The two keys of a job, one per purpose.
 *
 * `idempotencyKey` answers "is this the same step?" and `concurrencyKey`
 * answers "may this run now?". Collapsing them into one key was the defect that
 * made the chain impossible: a single key for the whole generation meant the
 * second step of the same run looked like a duplicate of the first and was
 * never enqueued.
 *
 * So the key names a **step**, never the work as a whole.
 */
export type JobKeyInput =
  | { kind: "generation.start"; generationRunId: string; siteProjectId: string }
  | { kind: "generation.poll"; generationRunId: string }
  | { kind: "checks.poll"; generationRunId: string; commitSha: string }
  | { kind: "preview.poll"; generationRunId: string; commitSha: string }
  | { kind: "credit.threshold"; reservationId: string };

export type JobKeys = {
  idempotencyKey: string;
  /** Null for observers, which do not exclude one another. */
  concurrencyKey: string | null;
};

export function idempotencyKeyFor(input: JobKeyInput): string {
  switch (input.kind) {
    case "generation.start":
      return `gen:${input.generationRunId}:start`;
    case "generation.poll":
      return `gen:${input.generationRunId}:poll`;
    // The commit is part of the key on purpose: a new revision of the same run
    // is another fact to observe, not the same observation repeated.
    case "checks.poll":
      return `checks:${input.generationRunId}:${input.commitSha}`;
    case "preview.poll":
      return `preview:${input.generationRunId}:${input.commitSha}`;
    case "credit.threshold":
      return `credit:${input.reservationId}`;
  }
}

export function concurrencyKeyFor(input: JobKeyInput): string | null {
  // Only `generation.start` mutates — it reserves credit and fires the agent.
  return input.kind === "generation.start" ? `project:${input.siteProjectId}` : null;
}

export function jobKeysFor(input: JobKeyInput): JobKeys {
  return {
    idempotencyKey: idempotencyKeyFor(input),
    concurrencyKey: concurrencyKeyFor(input),
  };
}

/**
 * Guards the invariant the two functions above encode together: a kind that
 * mutates has an exclusion key, and one that observes has none.
 */
export function keysAgreeWithKind(kind: JobKind, keys: JobKeys): boolean {
  return isMutatingKind(kind) === (keys.concurrencyKey !== null);
}
