/**
 * The closed vocabulary of the queue.
 *
 * Every list here is also written into a database index or a SQL predicate, so
 * they are exported rather than inlined: a status added in one place and
 * forgotten in the other is exactly how a job becomes invisible to the index
 * that was supposed to exclude it.
 */

export const JOB_KINDS = [
  "generation.start",
  "generation.poll",
  "checks.poll",
  "preview.poll",
  "credit.threshold",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "PENDENTE",
  "EM_EXECUCAO",
  "PAUSADO",
  /** Parado esperando gente. Nenhum handler decide sozinho sair daqui. */
  "CONCILIACAO",
  "CONCLUIDO",
  "FALHOU",
  "CARTA_MORTA",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * The same list as the `WHERE` of `Job_concurrency_ativo_uniq`.
 *
 * `CONCILIACAO` is in it on purpose. Work stopped waiting for a person is still
 * live work, and letting a second mutating job in over it would start the next
 * generation precisely while the previous one is under suspicion.
 */
export const ACTIVE_JOB_STATUSES = [
  "PENDENTE",
  "EM_EXECUCAO",
  "PAUSADO",
  "CONCILIACAO",
] as const satisfies readonly JobStatus[];

export const TERMINAL_JOB_STATUSES = [
  "CONCLUIDO",
  "FALHOU",
  "CARTA_MORTA",
] as const satisfies readonly JobStatus[];

/**
 * Kinds that mutate, and therefore exclude a sibling for the same project.
 *
 * Everything else observes. Locking observers by project was what kept the
 * chain from moving: `checks.poll` and `preview.poll` are siblings by design
 * and have to run in whatever order the consumer wakes them.
 */
export const MUTATING_JOB_KINDS = ["generation.start"] as const satisfies readonly JobKind[];

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === "string" && (JOB_KINDS as readonly string[]).includes(value);
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function isMutatingKind(kind: JobKind): boolean {
  return (MUTATING_JOB_KINDS as readonly string[]).includes(kind);
}

/**
 * Why a job is paused.
 *
 * Closed, and validated at runtime, because it lands in a column. The reason
 * always comes from the brake — a decision this application made about itself —
 * never from a provider explaining why it said no.
 */
export const PAUSE_REASONS = [
  /** `NOX_INTEGRATIONS=disabled`: the whole installation is braked. */
  "FREIO_GLOBAL",
  /** The provider is `DESLIGADO` for this organization. */
  "INTEGRACAO_DESLIGADA",
  /** The configured mode is not available in this phase. */
  "MODO_INDISPONIVEL",
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number];

export function isPauseReason(value: unknown): value is PauseReason {
  return typeof value === "string" && (PAUSE_REASONS as readonly string[]).includes(value);
}
