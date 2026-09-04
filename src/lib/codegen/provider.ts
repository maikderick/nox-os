import type { IntegrationMode } from "@/lib/integrations/modes";

import type { AgentIsolation } from "./isolation";

/**
 * The generation agent, as this application is willing to talk to it.
 *
 * Version two of the port, and the change from version one is the whole point
 * of the phase: `generate()` was one call that started work and reported it in
 * the same breath, which only works when the work is instantaneous. A real
 * agent takes minutes to hours, across a process that will not survive it, so
 * the port is `start` / `poll` / `cancel` — and every one of those has to be
 * safe to repeat, because the queue will repeat them.
 *
 * There is deliberately **no `estimateCost`**. Price is local policy, read from
 * a column an operator filled in; asking the provider what it charges would
 * make reserving credit depend on the provider being reachable, which is
 * precisely the moment reserving credit has to work.
 */

/** What we hold on to in order to ask about a run later. */
export type AgentRunRef = {
  /** The provider's identifier for the run. Goes to `GenerationRun.providerRunId`. */
  id: string;
  /** The key we sent. What `findRunByKey` is given back. */
  idempotencyKey: string;
};

/** The closed set of things a run can be. No provider text becomes a state. */
export const AGENT_RUN_STATES = [
  "PENDENTE",
  "EXECUTANDO",
  "CONCLUIDO",
  "FALHOU",
  "CANCELADO",
] as const;

export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

export function isAgentRunState(value: unknown): value is AgentRunState {
  return typeof value === "string" && (AGENT_RUN_STATES as readonly string[]).includes(value);
}

/**
 * What a poll answers.
 *
 * `branch`, `commitSha` and `pullRequestUrl` are present only on `CONCLUIDO`,
 * and the contract suite fixes that: a half-finished run reporting a branch
 * would let the poller create a `SiteRevision` for work the agent is still
 * doing, and the barrier would then wait forever on checks for a commit that is
 * about to be rewritten.
 */
export type AgentRunStatus = {
  state: AgentRunState;
  branch?: string;
  commitSha?: string;
  pullRequestUrl?: string;
};

export type AgentStartInput = {
  /** Ours, not the provider's. Also stored on the run. */
  idempotencyKey: string;
  /** Exactly one repository, and what the agent may not do. See `isolation.ts`. */
  isolation: AgentIsolation;
  /** The instruction. Built from confirmed brief facts, never from free text. */
  prompt: string;
};

/**
 * What a given provider can promise about repetition.
 *
 * These are read *before* deciding whether to call again after an ambiguous
 * outcome, which is the only decision in the phase where getting it wrong costs
 * money twice.
 */
export type AgentCapabilities = {
  /** Sending the same `idempotencyKey` twice starts at most one run. */
  idempotentStart: boolean;
  /** The provider can be asked what exists for a key. Enables `findRunByKey`. */
  reconcileByKey: boolean;
};

export interface CodeGenerationProvider {
  readonly id: string;
  readonly mode: IntegrationMode;
  readonly capabilities: AgentCapabilities;

  isConfigured(): Promise<boolean>;

  start(input: AgentStartInput): Promise<AgentRunRef>;
  poll(ref: AgentRunRef): Promise<AgentRunStatus>;
  /** Idempotent: cancelling a run that is already over is not an error. */
  cancel(ref: AgentRunRef): Promise<void>;

  /**
   * Finds the run created with this key, if any.
   *
   * **A provider without `reconcileByKey` must throw here, not return null.**
   * Null is an answer — "no run exists for that key" — and a provider that
   * cannot look would be asserting something it does not know, at the exact
   * moment the caller is deciding whether it is safe to spend money again.
   */
  findRunByKey(key: string): Promise<AgentRunRef | null>;
}

/** Raised by `findRunByKey` on a provider that cannot answer the question. */
export class AgentReconciliationUnsupportedError extends Error {
  readonly code = "RECONCILIACAO_NAO_SUPORTADA";

  constructor(providerId: string) {
    super(
      `O provedor ${providerId} não sabe consultar execuções por chave. Um resultado nulo aqui afirmaria que nada existe, e ele não tem como saber.`,
    );
    this.name = "AgentReconciliationUnsupportedError";
  }
}
