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
] as const;

export type JobReason = (typeof JOB_REASONS)[number];

/**
 * Fields that may appear in a stored message.
 *
 * All of them are values this application produced: a kind from its own enum, a
 * status from its own enum, a key it built itself. Nothing is ever copied from
 * a provider response.
 */
export type JobDetails = {
  kind?: string;
  status?: string;
  concurrencyKey?: string;
  idempotencyKey?: string;
  attempts?: number;
  maxAttempts?: number;
};

const BUILDERS: Record<JobReason, (details: JobDetails) => string> = {
  FORA_DE_TRANSACAO: () =>
    "Um job só pode ser enfileirado dentro da transação que grava o fato que o justifica. Enfileirar fora dela cria trabalho para algo que pode não ter acontecido.",

  TIPO_DESCONHECIDO: (d) => `O tipo de job ${d.kind ?? "informado"} não existe nesta fase.`,

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
