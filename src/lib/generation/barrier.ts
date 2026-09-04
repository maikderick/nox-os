/**
 * The barrier: three facts in, one decision out, and nothing written.
 *
 * A generation is finished when the agent, the required check and the preview
 * deployment all agree — and "agree" is stronger than "all three are done".
 * They have to be about the **same `SiteRevision` and the same `commitSha`**,
 * because the interesting failure is not a missing fact, it is a stale one: a
 * check from the previous commit reporting green over a revision that replaced
 * it would close the generation on work nobody verified.
 *
 * The function is pure on purpose. Whoever applies what it decided is racing a
 * sibling that read the same three facts in the same instant, and that race is
 * settled by a conditional update in `applySystemTransition` — not here.
 * Keeping the decision separate from the write is what makes the decision
 * testable without a database and the write correct without a lock.
 */

/** The agent's fact, as `generation.poll` persisted it. */
export type RunFact = {
  status: string;
  siteRevisionId: string | null;
  commitSha: string | null;
};

/** The check's fact, as `checks.poll` persisted it. */
export type CheckFact = {
  siteRevisionId: string;
  commitSha: string;
  name: string;
  conclusion: string;
};

/** The preview's fact, as `preview.poll` persisted it. */
export type PreviewFact = {
  siteRevisionId: string;
  commitSha: string | null;
  status: string;
};

export type BarrierInput = {
  run: RunFact;
  check: CheckFact | null;
  preview: PreviewFact | null;
  /** The check the repository's ruleset requires. Anything else is not it. */
  requiredCheck: string;
};

export const BARRIER_OUTCOMES = ["AGUARDANDO", "PREVIA_PRONTA", "FALHOU"] as const;
export type BarrierOutcome = (typeof BARRIER_OUTCOMES)[number];

/** Why the barrier decided as it did. Closed, and it reaches an audit line. */
export const BARRIER_REASONS = [
  "TRES_FATOS_ALINHADOS",
  "CHECK_FALHOU",
  "PREVIA_FALHOU",
  "AGENTE_FALHOU",
  "FATOS_INCOMPLETOS",
  "FATOS_DE_REVISOES_DIFERENTES",
] as const;

export type BarrierReason = (typeof BARRIER_REASONS)[number];

export type BarrierDecision = {
  outcome: BarrierOutcome;
  reason: BarrierReason;
};

const CHECK_FAILED = new Set(["FALHA", "AUSENTE"]);
const CHECK_PASSED = "SUCESSO";

const PREVIEW_FAILED = new Set(["FALHOU", "CANCELADO"]);
const PREVIEW_READY = "PRONTO";

export function evaluateGenerationOutcome(input: BarrierInput): BarrierDecision {
  const { run, check, preview } = input;

  // The agent's own failure needs no siblings: there is no revision for them to
  // be about.
  if (run.status === "FALHOU" || run.status === "CANCELADO") {
    return { outcome: "FALHOU", reason: "AGENTE_FALHOU" };
  }

  if (run.status !== "CONCLUIDO" || !run.siteRevisionId || !run.commitSha) {
    return { outcome: "AGUARDANDO", reason: "FATOS_INCOMPLETOS" };
  }

  // Alignment is checked **before** conclusions are read. A fact about another
  // revision is not a weaker fact about this one; it is not a fact about this
  // one at all, and letting a stale failure fail the current generation is the
  // same defect as letting a stale success pass it.
  const aligned = <T extends { siteRevisionId: string; commitSha: string | null }>(
    fact: T | null,
  ): T | null => {
    if (!fact) return null;
    if (fact.siteRevisionId !== run.siteRevisionId) return null;
    if (fact.commitSha !== null && fact.commitSha !== run.commitSha) return null;
    return fact;
  };

  const ownCheck = aligned(check);
  const ownPreview = aligned(preview);

  const misaligned = (check !== null && ownCheck === null) || (preview !== null && ownPreview === null);

  // The required check is the one the repository's ruleset names. A green run
  // of some other check is not the fact the barrier is waiting for.
  const relevantCheck = ownCheck && ownCheck.name === input.requiredCheck ? ownCheck : null;

  // A failure decides as soon as it is known, and does not wait for the sibling
  // — the sibling is cancelled instead. Waiting would mean a green preview
  // could still arrive and make the pair look ambiguous.
  if (relevantCheck && CHECK_FAILED.has(relevantCheck.conclusion)) {
    return { outcome: "FALHOU", reason: "CHECK_FALHOU" };
  }
  if (ownPreview && PREVIEW_FAILED.has(ownPreview.status)) {
    return { outcome: "FALHOU", reason: "PREVIA_FALHOU" };
  }

  if (relevantCheck?.conclusion === CHECK_PASSED && ownPreview?.status === PREVIEW_READY) {
    return { outcome: "PREVIA_PRONTA", reason: "TRES_FATOS_ALINHADOS" };
  }

  return {
    outcome: "AGUARDANDO",
    reason: misaligned ? "FATOS_DE_REVISOES_DIFERENTES" : "FATOS_INCOMPLETOS",
  };
}
