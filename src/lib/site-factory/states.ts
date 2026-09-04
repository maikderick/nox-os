import type { Permission } from "@/lib/authz/permissions";

/**
 * The life of a site project, from an empty draft to a published site.
 *
 * Two rules are encoded here rather than in the routes: nothing reaches
 * `PUBLICANDO` without someone holding `publish:approve`, and no state before
 * `PUBLICADO` is public.
 */
export const SITE_PROJECT_STATES = [
  "RASCUNHO",
  "BRIEFING_PRONTO",
  "GERANDO",
  "PREVIA_PRONTA",
  "EM_REVISAO",
  "APROVADO",
  "PUBLICANDO",
  "PUBLICADO",
  "FALHOU",
] as const;

export type SiteProjectState = (typeof SITE_PROJECT_STATES)[number];

export const SITE_PROJECT_STATE_LABELS: Record<SiteProjectState, string> = {
  RASCUNHO: "Rascunho",
  BRIEFING_PRONTO: "Briefing pronto",
  GERANDO: "Gerando",
  PREVIA_PRONTA: "Prévia pronta",
  EM_REVISAO: "Em revisão",
  APROVADO: "Aprovado",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  FALHOU: "Falhou",
};

export type SiteProjectTransition = {
  from: SiteProjectState;
  to: SiteProjectState;
  /**
   * The permission a person needs to trigger it. `null` marks a transition only
   * the orchestrator performs, when a generation run or a deployment reports
   * back — no human can request it directly.
   */
  permission: Permission | null;
  label: string;
};

export const SITE_PROJECT_TRANSITIONS: SiteProjectTransition[] = [
  { from: "RASCUNHO", to: "BRIEFING_PRONTO", permission: "brief:write", label: "Concluir briefing" },
  { from: "BRIEFING_PRONTO", to: "RASCUNHO", permission: "brief:write", label: "Reabrir briefing" },
  { from: "BRIEFING_PRONTO", to: "GERANDO", permission: "generation:run", label: "Gerar site" },

  { from: "GERANDO", to: "PREVIA_PRONTA", permission: null, label: "Geração concluída" },
  { from: "GERANDO", to: "FALHOU", permission: null, label: "Geração falhou" },

  { from: "PREVIA_PRONTA", to: "EM_REVISAO", permission: "project:write", label: "Enviar para revisão" },
  { from: "PREVIA_PRONTA", to: "GERANDO", permission: "generation:run", label: "Gerar novamente" },

  { from: "EM_REVISAO", to: "APROVADO", permission: "publish:approve", label: "Aprovar" },
  { from: "EM_REVISAO", to: "BRIEFING_PRONTO", permission: "brief:write", label: "Pedir ajustes no briefing" },
  { from: "EM_REVISAO", to: "GERANDO", permission: "generation:run", label: "Gerar novamente" },

  { from: "APROVADO", to: "EM_REVISAO", permission: "publish:approve", label: "Revogar aprovação" },
  { from: "APROVADO", to: "PUBLICANDO", permission: "publish:approve", label: "Publicar" },

  { from: "PUBLICANDO", to: "PUBLICADO", permission: null, label: "Publicação concluída" },
  { from: "PUBLICANDO", to: "FALHOU", permission: null, label: "Publicação falhou" },

  { from: "PUBLICADO", to: "GERANDO", permission: "generation:run", label: "Gerar nova versão" },
  { from: "PUBLICADO", to: "RASCUNHO", permission: "brief:write", label: "Iniciar novo ciclo" },

  { from: "FALHOU", to: "GERANDO", permission: "generation:run", label: "Tentar gerar de novo" },
  { from: "FALHOU", to: "BRIEFING_PRONTO", permission: "brief:write", label: "Voltar ao briefing" },
  { from: "FALHOU", to: "RASCUNHO", permission: "brief:write", label: "Voltar ao rascunho" },
];

export function isSiteProjectState(value: unknown): value is SiteProjectState {
  return typeof value === "string" && (SITE_PROJECT_STATES as readonly string[]).includes(value);
}

export function transitionsFrom(state: SiteProjectState): SiteProjectTransition[] {
  return SITE_PROJECT_TRANSITIONS.filter((transition) => transition.from === state);
}

export function findTransition(
  from: SiteProjectState,
  to: SiteProjectState,
): SiteProjectTransition | null {
  return (
    SITE_PROJECT_TRANSITIONS.find(
      (transition) => transition.from === from && transition.to === to,
    ) ?? null
  );
}

export function canTransition(from: SiteProjectState, to: SiteProjectState): boolean {
  return findTransition(from, to) !== null;
}

/**
 * Every state from which the machine authorises reaching `to`.
 *
 * Read by the conditional update that starts a generation, so the list of
 * eligible states lives in exactly one place. Writing it out at the call site
 * would keep the state machine in two files, which is how the two diverge — and
 * the second copy is always the one nobody remembers to update.
 */
export function statesWithTransitionTo(to: SiteProjectState): SiteProjectState[] {
  return SITE_PROJECT_TRANSITIONS.filter((transition) => transition.to === to).map(
    (transition) => transition.from,
  );
}

/**
 * Whether a transition is the orchestrator's to make, rather than a person's.
 *
 * `permission: null` is what marks one. A human asking for it is refused
 * wherever transitions are requested; this is the other half — the machinery
 * that reports one checks that it is reporting something only machinery may.
 */
export function isSystemTransition(from: SiteProjectState, to: SiteProjectState): boolean {
  return findTransition(from, to)?.permission === null;
}

/**
 * Transitions a person may ask for, given what they can do.
 *
 * System transitions are excluded on purpose: they are reported, never
 * requested. Stages whose orchestrator does not exist yet are excluded too, so
 * the UI never offers an action the domain is about to refuse.
 */
export function allowedTransitionsFor(
  state: SiteProjectState,
  permissions: readonly Permission[],
): SiteProjectTransition[] {
  const granted = new Set(permissions);
  return transitionsFrom(state).filter(
    (transition) =>
      transition.permission !== null &&
      granted.has(transition.permission) &&
      !isStagePendingOrchestrator(transition.to) &&
      // Offered by its own endpoint, not by the generic transition control. A
      // button here would post a status change and strand the project.
      !isStageRequestedNotTransitioned(transition.to),
  );
}

/** Only a published project is visible to the world. Everything else is internal. */
export function isPublicState(state: SiteProjectState): boolean {
  return state === "PUBLICADO";
}

/** States whose preview a signed-in member of the organization may open. */
export function hasInternalPreview(state: SiteProjectState): boolean {
  return (
    state === "PREVIA_PRONTA" ||
    state === "EM_REVISAO" ||
    state === "APROVADO" ||
    state === "PUBLICANDO" ||
    state === "PUBLICADO"
  );
}

export class SiteProjectTransitionError extends Error {
  readonly from: SiteProjectState;
  readonly to: SiteProjectState;

  constructor(from: SiteProjectState, to: SiteProjectState) {
    super(
      `Transição inválida: ${SITE_PROJECT_STATE_LABELS[from]} → ${SITE_PROJECT_STATE_LABELS[to]}.`,
    );
    this.name = "SiteProjectTransitionError";
    this.from = from;
    this.to = to;
  }
}

// ---------------------------------------------------------------------------
// Etapas ainda sem orquestrador
// ---------------------------------------------------------------------------

/**
 * States a person cannot move a project into yet.
 *
 * `GERANDO` left this list when its orchestrator arrived: the durable queue
 * creates the `GenerationRun`, calls the agent, records the result and applies
 * the system transition that gets the project out again. `PUBLICANDO` is still
 * here, waiting on the deployment flow — the way out of it is a system
 * transition, and nothing reports one yet, so letting someone in would strand
 * the project.
 *
 * Removing a state from this list is the last step of wiring its orchestrator,
 * never a standalone change.
 */
export const STAGES_PENDING_ORCHESTRATOR = ["PUBLICANDO"] as const;

export type StagePendingOrchestrator = (typeof STAGES_PENDING_ORCHESTRATOR)[number];

export function isStagePendingOrchestrator(
  state: SiteProjectState,
): state is StagePendingOrchestrator {
  return (STAGES_PENDING_ORCHESTRATOR as readonly string[]).includes(state);
}

/**
 * States a person may not move a project into **by transitioning**, even though
 * something does move projects into them.
 *
 * `GERANDO` is the case. It has an orchestrator now, so it is no longer
 * "pending" — but the way in is `POST /api/projects/:id/generate`, which
 * creates the `GenerationRun`, reserves the credit and enqueues the work in one
 * transaction. A plain status change would put the project in `GERANDO` with
 * none of those, and the only way out of `GERANDO` is a system transition
 * reported by a run that would not exist. The project would be stranded, and it
 * would look, on every screen, exactly like one that was working.
 *
 * So the state machine keeps the transition — it is real, it is how the project
 * gets there, and the permission on it is the right one — and this list marks
 * the door a person may not walk through directly.
 */
export const STAGES_REQUESTED_NOT_TRANSITIONED = ["GERANDO"] as const;

export type StageRequestedNotTransitioned =
  (typeof STAGES_REQUESTED_NOT_TRANSITIONED)[number];

export function isStageRequestedNotTransitioned(
  state: SiteProjectState,
): state is StageRequestedNotTransitioned {
  return (STAGES_REQUESTED_NOT_TRANSITIONED as readonly string[]).includes(state);
}

const STAGE_REQUEST_ROUTE: Record<StageRequestedNotTransitioned, string> = {
  GERANDO:
    "A geração é pedida, não transicionada: use POST /api/projects/:id/generate com um cabeçalho Idempotency-Key. Só esse caminho cria a execução, reserva o crédito e enfileira o trabalho na mesma transação — mudar o estado à mão deixaria o projeto em GERANDO sem nada que o tire de lá.",
};

/**
 * Raised instead of moving the project, so the refusal never leaves a row in a
 * state nothing can leave.
 */
export class SiteProjectStageNotTransitionableError extends Error {
  readonly code = "ETAPA_PEDIDA_NAO_TRANSICIONADA";
  readonly state: StageRequestedNotTransitioned;

  constructor(state: StageRequestedNotTransitioned) {
    super(STAGE_REQUEST_ROUTE[state]);
    this.name = "SiteProjectStageNotTransitionableError";
    this.state = state;
  }
}

/** Stable codes, so a client can branch on the reason without parsing prose. */
export const SITE_PROJECT_ERROR_CODES = {
  stageUnavailable: "ETAPA_INDISPONIVEL",
  stageNotTransitionable: "ETAPA_PEDIDA_NAO_TRANSICIONADA",
  invalidTransition: "TRANSICAO_INVALIDA",
} as const;

const STAGE_UNAVAILABLE_REASON: Record<StagePendingOrchestrator, string> = {
  PUBLICANDO:
    "A publicação ainda não está disponível: o fluxo de deployment não existe nesta fase.",
};

/**
 * Raised instead of moving the project, so the refusal never leaves a row in a
 * state nothing can leave.
 */
export class SiteProjectStageUnavailableError extends Error {
  readonly code = SITE_PROJECT_ERROR_CODES.stageUnavailable;
  readonly state: StagePendingOrchestrator;

  constructor(state: StagePendingOrchestrator) {
    super(STAGE_UNAVAILABLE_REASON[state]);
    this.name = "SiteProjectStageUnavailableError";
    this.state = state;
  }
}
