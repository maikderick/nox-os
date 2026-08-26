import { isJobKind, isJobStatus, type JobKind, type JobStatus } from "./kinds";

/**
 * Every refusal the queue can express, and the only text it may store.
 *
 * Same rule as `provisioning/reasons.ts`, for the same reason: a message is
 * *rebuilt* from a closed set plus fields this application produced, never
 * copied from an object someone else constructed. A `Job.lastError` is read by
 * more people than a stack trace ever is.
 */

export const JOB_REASONS = [
  "FORA_DE_TRANSACAO",
  "TIPO_DESCONHECIDO",
  "CHAVES_INCOERENTES",
  "PAYLOAD_INVALIDO",
  "PROJETO_DE_OUTRA_ORGANIZACAO",
  "RUN_DE_OUTRA_ORGANIZACAO",
  "RUN_DE_OUTRO_PROJETO",
  "IDENTIDADE_DIVERGENTE",
  "CHAVE_REUSADA_COM_OUTRO_CONTEUDO",
  "ETAPA_ENFILEIRADA_CONCORRENTEMENTE",
  "TRABALHO_EM_ANDAMENTO",
  "PRAZO_DE_ESPERA_ESTOURADO",
  "TENTATIVAS_ESGOTADAS",
  "JOB_NAO_REPROCESSAVEL",
  "MOTIVO_DE_PAUSA_DESCONHECIDO",
  "RESGATES_SUCESSIVOS",
] as const;

export type JobReason = (typeof JOB_REASONS)[number];

/**
 * Fields that may appear in a stored message.
 *
 * Every one of them is drawn from a **closed set** this application defines —
 * a kind from its own enum, a status from its own enum, a count it incremented
 * itself. Nothing here is free text, and that is deliberate: the earlier
 * version accepted `string`, which meant "any value that reached a call site
 * can reach a column", and the call site is exactly where an unrecognised
 * provider value tends to be sitting.
 *
 * The keys the queue builds — `idempotencyKey`, `concurrencyKey` — are gone.
 * They are ours, but they are still free-form strings assembled from ids, and
 * no message needed them.
 */
export type JobDetails = {
  kind?: JobKind;
  status?: JobStatus;
  attempts?: number;
  maxAttempts?: number;
};

const BUILDERS: Record<JobReason, (details: JobDetails) => string> = {
  FORA_DE_TRANSACAO: () =>
    "Um job só pode ser enfileirado dentro da transação que grava o fato que o justifica. Enfileirar fora dela cria trabalho para algo que pode não ter acontecido.",

  // Deliberately says nothing about what arrived. The value that reached
  // here failed to be one of ours, which is the one circumstance in which
  // echoing it back would be echoing something unvetted.
  TIPO_DESCONHECIDO: () => "O tipo de job informado não existe nesta fase.",

  CHAVES_INCOERENTES: (d) =>
    `As chaves não combinam com o tipo ${d.kind ?? "informado"}: trabalho que muta precisa de chave de concorrência, e observador não pode ter uma.`,

  PAYLOAD_INVALIDO: () =>
    "O payload do job aceita apenas identificadores gerados pelo NOX OS. Nenhum outro campo é gravado.",

  PROJETO_DE_OUTRA_ORGANIZACAO: () =>
    "O projeto informado pertence a outra organização. O job não foi criado.",

  RUN_DE_OUTRA_ORGANIZACAO: () =>
    "A geração informada pertence a outra organização. O job não foi criado.",

  RUN_DE_OUTRO_PROJETO: () =>
    "A geração informada pertence a outro projeto desta organização. O job não foi criado.",

  IDENTIDADE_DIVERGENTE: (d) =>
    `Os identificadores informados não conferem com a etapa ${d.kind ?? "solicitada"}. O job não foi criado.`,

  CHAVE_REUSADA_COM_OUTRO_CONTEUDO: (d) =>
    `Já existe um job para esta etapa de ${d.kind ?? "trabalho"} com conteúdo diferente do informado. A mesma etapa não pode significar duas coisas.`,

  ETAPA_ENFILEIRADA_CONCORRENTEMENTE: () =>
    "Outra transação enfileirou esta mesma etapa neste instante. Refaça a operação: a etapa existe, e a repetição vai encontrá-la.",

  TRABALHO_EM_ANDAMENTO: () =>
    "Já existe um trabalho em andamento para este projeto. Aguarde ele terminar ou resolva a conciliação pendente.",

  PRAZO_DE_ESPERA_ESTOURADO: (d) =>
    `A espera passou do prazo previsto para ${d.kind ?? "esta etapa"}. O job foi para conciliação, sem ser repetido.`,

  TENTATIVAS_ESGOTADAS: (d) =>
    `A etapa falhou ${d.attempts ?? d.maxAttempts ?? 0} vezes e não será repetida automaticamente.`,

  JOB_NAO_REPROCESSAVEL: (d) =>
    `Só um job em carta morta pode ser reprocessado.${d.status ? ` Estado atual: ${d.status}.` : ""}`,

  MOTIVO_DE_PAUSA_DESCONHECIDO: () =>
    "O motivo de pausa informado não é um dos motivos previstos. Um job só é pausado por decisão do freio.",

  RESGATES_SUCESSIVOS: () =>
    "Consumidores morreram seguidas vezes executando este job, e ele foi para conciliação em vez de ser resgatado de novo. Um trabalho que derruba quem o executa não se resolve tentando mais uma vez.",
};

export function buildJobReasonMessage(reason: JobReason, details: JobDetails = {}): string {
  return BUILDERS[reason](details);
}

/**
 * The one refusal type the queue raises.
 *
 * Its message is built from the reason, so what a developer reads in a stack
 * trace and what lands in a column are the same safe text.
 */
export class JobRefusal extends Error {
  readonly reason: JobReason;
  readonly details: JobDetails;
  /** Same value as `reason`, under the name the HTTP layer already uses. */
  readonly code: JobReason;

  constructor(reason: JobReason, details: JobDetails = {}) {
    super(buildJobReasonMessage(reason, details));
    this.name = "JobRefusal";
    this.reason = reason;
    this.details = details;
    this.code = reason;
  }
}

export function isJobRefusal(error: unknown): error is JobRefusal {
  return error instanceof JobRefusal;
}

export function isJobReason(value: unknown): value is JobReason {
  return typeof value === "string" && (JOB_REASONS as readonly string[]).includes(value);
}

/**
 * Rebuilds `details` from scratch, keeping only values that are still one of
 * ours.
 *
 * `instanceof` is not a guarantee about content. `JobRefusal` is exported and
 * extensible, its fields are plain properties, and a subclass — or any code
 * holding an instance — can put whatever it likes in `details` before the
 * object reaches a column. TypeScript checks the call site; it does not check
 * the object that arrives at the sink.
 *
 * So nothing that arrives is kept. Each field is re-derived by asking the
 * closed set whether it recognises the value, and anything it does not
 * recognise simply disappears — leaving a message that reads slightly more
 * generically, which is the correct trade.
 */
export function sanitizeJobDetails(raw: unknown): JobDetails {
  if (raw === null || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const details: JobDetails = {};

  if (isJobKind(candidate.kind)) details.kind = candidate.kind;
  if (isJobStatus(candidate.status)) details.status = candidate.status;
  // A count, not a quantity someone sent us: bounded, integral, non-negative.
  for (const field of ["attempts", "maxAttempts"] as const) {
    const value = candidate[field];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 10_000) {
      details[field] = value;
    }
  }

  return details;
}
