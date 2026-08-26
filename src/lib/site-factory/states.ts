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
      !isStagePendingOrchestrator(transition.to),
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
 * `GERANDO` only makes sense once a service creates the `GenerationRun`, calls
 * the provider, records the result and applies the matching system transition.
 * `PUBLICANDO` waits on the deployment flow. Until each half exists, letting
 * someone in would strand the project: the way out of both is a system
 * transition, and no orchestrator exists to report one.
 *
 * Removing a state from this list is the last step of wiring its orchestrator,
 * never a standalone change.
 */
export const STAGES_PENDING_ORCHESTRATOR = ["GERANDO", "PUBLICANDO"] as const;

export type StagePendingOrchestrator = (typeof STAGES_PENDING_ORCHESTRATOR)[number];

export function isStagePendingOrchestrator(
  state: SiteProjectState,
): state is StagePendingOrchestrator {
  return (STAGES_PENDING_ORCHESTRATOR as readonly string[]).includes(state);
}

/** Stable codes, so a client can branch on the reason without parsing prose. */
export const SITE_PROJECT_ERROR_CODES = {
  stageUnavailable: "ETAPA_INDISPONIVEL",
  invalidTransition: "TRANSICAO_INVALIDA",
} as const;

const STAGE_UNAVAILABLE_REASON: Record<StagePendingOrchestrator, string> = {
  GERANDO:
    "A geração de código ainda não está disponível: nenhum provedor executa a geração nem registra o resultado nesta fase.",
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
