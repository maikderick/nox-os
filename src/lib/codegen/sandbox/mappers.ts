import { type AgentRunState, type AgentRunStatus } from "../provider";

/**
 * Reads the shape the agent's API actually returns.
 *
 * This is the half the fake cannot prove. The fake decides both the question
 * and the answer, so it can never catch a status spelled `FINISHED` where this
 * application says `CONCLUIDO`, or a pull request url nested under `target`
 * instead of sitting at the top level. These mappers run against recorded
 * payloads today and are the same code a live client would use.
 */

export type AgentRunPayload = {
  id: string;
  /** QUEUED | RUNNING | FINISHED | ERROR | CANCELLED, as the provider spells it. */
  status: string;
  source?: { repository?: string; ref?: string } | null;
  target?: {
    branchName?: string;
    prUrl?: string;
    url?: string;
    autoCreatePr?: boolean;
  } | null;
  summary?: { commitSha?: string } | null;
};

/**
 * The provider's vocabulary to ours.
 *
 * An unrecognised status maps to `PENDENTE`, never to a terminal state. Reading
 * a word we do not know as "finished" would create a `SiteRevision` from a run
 * whose outcome nobody established; reading it as "failed" would fail a run
 * that may well be fine. `PENDENTE` costs another poll and a deadline, and the
 * deadline is what turns "we still do not understand this" into conciliation
 * rather than into a decision.
 */
const STATES: Record<string, AgentRunState> = {
  QUEUED: "PENDENTE",
  PENDING: "PENDENTE",
  CREATING: "PENDENTE",
  RUNNING: "EXECUTANDO",
  FINISHED: "CONCLUIDO",
  COMPLETED: "CONCLUIDO",
  ERROR: "FALHOU",
  FAILED: "FALHOU",
  CANCELLED: "CANCELADO",
  CANCELED: "CANCELADO",
};

export function mapAgentRunState(raw: string): AgentRunState {
  return STATES[raw.trim().toUpperCase()] ?? "PENDENTE";
}

export function mapAgentRunStatus(payload: AgentRunPayload): AgentRunStatus {
  const state = mapAgentRunState(payload.status);
  if (state !== "CONCLUIDO") return { state };

  const branch = payload.target?.branchName;
  const commitSha = payload.summary?.commitSha;
  const pullRequestUrl = payload.target?.prUrl ?? payload.target?.url;

  return {
    state,
    ...(branch ? { branch } : {}),
    ...(commitSha ? { commitSha } : {}),
    ...(pullRequestUrl ? { pullRequestUrl } : {}),
  };
}
