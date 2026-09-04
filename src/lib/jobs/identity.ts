import { type JobKind } from "./kinds";
import { type JobKeyInput } from "./keys";
import { encodeJobPayload, type JobPayload } from "./payload";
import { JobRefusal } from "./reasons";

/**
 * `step` is what a job *is*. Everything else is derived from it.
 *
 * The alternative — a caller passing `step`, plus the foreign keys, plus the
 * payload, each independently — means three descriptions of the same job that
 * only agree by discipline. The key would say `gen:run-1:poll` while the FK
 * pointed at `run-2` and the payload carried `run-3`, and every one of the
 * three would look right to whoever wrote that call. The handler then reads one
 * of them, the queue screen reads another, and the exclusion index a third.
 *
 * So the identity is computed here, once, and anything the caller supplies on
 * top is checked for **exact** agreement rather than merged.
 */
export type JobIdentity = {
  generationRunId: string | null;
  siteProjectId: string | null;
  payload: JobPayload;
};

/** What the step alone determines, before the database is consulted. */
export function identityFromStep(step: JobKeyInput): JobIdentity {
  switch (step.kind) {
    case "generation.start":
      return {
        generationRunId: step.generationRunId,
        siteProjectId: step.siteProjectId,
        payload: { generationRunId: step.generationRunId, siteProjectId: step.siteProjectId },
      };
    case "generation.poll":
      return {
        generationRunId: step.generationRunId,
        siteProjectId: null,
        payload: { generationRunId: step.generationRunId },
      };
    case "checks.poll":
    case "preview.poll":
      return {
        generationRunId: step.generationRunId,
        siteProjectId: null,
        payload: { generationRunId: step.generationRunId, commitSha: step.commitSha },
      };
    case "credit.threshold":
      return {
        generationRunId: null,
        siteProjectId: null,
        payload: { reservationId: step.reservationId },
      };
  }
}

/**
 * Folds a caller-supplied value into a derived one.
 *
 * Silence is agreement; a different value is a refusal, never an override. A
 * caller who knows better than the step is a caller who built the step wrong.
 */
export function agreeOn<T>(derived: T | null, supplied: T | null | undefined, kind: JobKind): T | null {
  if (supplied === undefined || supplied === null) return derived;
  if (derived !== null && derived !== supplied) {
    throw new JobRefusal("IDENTIDADE_DIVERGENTE", { kind });
  }
  return supplied;
}

/**
 * Merges an extra payload into the derived one, field by field.
 *
 * Extra fields are allowed — a handler may need a revision id the step does not
 * name. Contradicting a derived field is not.
 */
export function mergePayload(
  derived: JobPayload,
  supplied: JobPayload | undefined,
  kind: JobKind,
): JobPayload {
  if (!supplied) return derived;

  for (const [field, value] of Object.entries(supplied)) {
    if (value === undefined) continue;
    const own = derived[field as keyof JobPayload];
    if (own !== undefined && own !== value) {
      throw new JobRefusal("IDENTIDADE_DIVERGENTE", { kind });
    }
  }

  return { ...supplied, ...derived };
}

/**
 * The part of a job that may never change once the key exists.
 *
 * Scheduling — `runAfter`, `maxAttempts`, `pollDeadlineAt` — is deliberately
 * out: re-enqueueing the same step later with a different delay is legitimate,
 * and the row that already exists keeps its own schedule. What must not change
 * is what the job *means*.
 */
export type ImmutableContent = {
  kind: string;
  concurrencyKey: string | null;
  siteProjectId: string | null;
  generationRunId: string | null;
  payloadJson: string;
};

export function contentMatches(existing: ImmutableContent, wanted: ImmutableContent): boolean {
  return (
    existing.kind === wanted.kind &&
    existing.concurrencyKey === wanted.concurrencyKey &&
    existing.siteProjectId === wanted.siteProjectId &&
    existing.generationRunId === wanted.generationRunId &&
    // Both sides go through `encodeJobPayload`, which sorts the keys, so this
    // compares content rather than the order someone wrote the object literal.
    existing.payloadJson === wanted.payloadJson
  );
}

export { encodeJobPayload };
