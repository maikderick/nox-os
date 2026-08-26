import { describe, expect, it } from "vitest";

import {
  concurrencyKeyFor,
  idempotencyKeyFor,
  jobKeysFor,
  keysAgreeWithKind,
  type JobKeyInput,
} from "@/lib/jobs/keys";
import { JOB_KINDS, isMutatingKind } from "@/lib/jobs/kinds";

const RUN = "run-1";
const PROJECT = "project-1";
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const EVERY_STEP: JobKeyInput[] = [
  { kind: "generation.start", generationRunId: RUN, siteProjectId: PROJECT },
  { kind: "generation.poll", generationRunId: RUN },
  { kind: "checks.poll", generationRunId: RUN, commitSha: SHA_A },
  { kind: "preview.poll", generationRunId: RUN, commitSha: SHA_A },
  { kind: "credit.threshold", reservationId: "reservation-1" },
];

describe("a key names a step, not a job", () => {
  it("covers every kind, so a new one cannot be forgotten here", () => {
    expect(EVERY_STEP.map((step) => step.kind).sort()).toEqual([...JOB_KINDS].sort());
  });

  it("gives each step of the same run its own key", () => {
    const keys = EVERY_STEP.map(idempotencyKeyFor);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("repeats the key for the same step of the same run", () => {
    for (const step of EVERY_STEP) {
      expect(idempotencyKeyFor(step)).toBe(idempotencyKeyFor({ ...step }));
    }
  });

  it("separates the start of one run from the start of another", () => {
    expect(
      idempotencyKeyFor({ kind: "generation.start", generationRunId: "run-2", siteProjectId: PROJECT }),
    ).not.toBe(idempotencyKeyFor(EVERY_STEP[0]!));
  });

  it("treats a new commit of the same run as another fact to observe", () => {
    // A second revision is not the same observation repeated: it is a different
    // commit, with its own checks and its own deployment.
    expect(idempotencyKeyFor({ kind: "checks.poll", generationRunId: RUN, commitSha: SHA_A })).not.toBe(
      idempotencyKeyFor({ kind: "checks.poll", generationRunId: RUN, commitSha: SHA_B }),
    );
    expect(idempotencyKeyFor({ kind: "preview.poll", generationRunId: RUN, commitSha: SHA_A })).not.toBe(
      idempotencyKeyFor({ kind: "preview.poll", generationRunId: RUN, commitSha: SHA_B }),
    );
  });

  it("does not let checks and preview of the same commit collide", () => {
    expect(idempotencyKeyFor({ kind: "checks.poll", generationRunId: RUN, commitSha: SHA_A })).not.toBe(
      idempotencyKeyFor({ kind: "preview.poll", generationRunId: RUN, commitSha: SHA_A }),
    );
  });
});

describe("only mutating work excludes a sibling", () => {
  it("gives the project key to `generation.start` and to nothing else", () => {
    expect(concurrencyKeyFor(EVERY_STEP[0]!)).toBe(`project:${PROJECT}`);
    for (const step of EVERY_STEP.slice(1)) {
      expect(concurrencyKeyFor(step)).toBeNull();
    }
  });

  it("keeps kind and keys in agreement, by construction", () => {
    for (const step of EVERY_STEP) {
      const keys = jobKeysFor(step);
      expect(keysAgreeWithKind(step.kind, keys)).toBe(true);
      expect(keys.concurrencyKey !== null).toBe(isMutatingKind(step.kind));
    }
  });

  it("catches keys that were built for another kind", () => {
    // Locking observers by project was what kept the chain from moving: the two
    // siblings would have excluded each other and neither would ever run.
    expect(
      keysAgreeWithKind("checks.poll", { idempotencyKey: "x", concurrencyKey: "project:1" }),
    ).toBe(false);
    expect(keysAgreeWithKind("generation.start", { idempotencyKey: "x", concurrencyKey: null })).toBe(
      false,
    );
  });
});
