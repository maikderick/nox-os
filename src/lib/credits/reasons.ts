/**
 * Every refusal the credit machinery can express, and the only text it stores.
 *
 * Same rule as everywhere else in this phase: a message is rebuilt from a
 * closed set plus values this application produced. A `reasonCode` in the
 * ledger is read during a reconciliation, months later, by someone trying to
 * explain a number — it is the last place free text belongs.
 */

export const CREDIT_REASONS = [
  "PRECO_NAO_CONFIGURADO",
  "CONTA_NAO_ENCONTRADA",
  "CONTA_BLOQUEADA",
  "SALDO_INSUFICIENTE",
  "TETO_MENSAL_ATINGIDO",
  "VALOR_INVALIDO",
  "ORGANIZACAO_DIVERGENTE",
  "RESERVA_DUPLICADA",
  "CUSTO_ACIMA_DA_RESERVA",
  "EFEITO_AMBIGUO_NA_GERACAO",
  "RESERVA_NAO_LIQUIDAVEL",
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

/** Movements the ledger knows. The same closed list the database CHECK holds. */
export const LEDGER_MOVEMENTS = [
  "RESERVA",
  "CONSUMO",
  "LIBERACAO",
  "AJUSTE",
  "BLOQUEIO",
  "ROLLOVER",
  "APORTE",
] as const;

export type LedgerMovement = (typeof LEDGER_MOVEMENTS)[number];

/** Reservation states. Also mirrored by a CHECK. */
export const RESERVATION_STATUSES = ["RESERVADA", "CONSUMIDA", "LIBERADA", "CONCILIACAO"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** How an amount was arrived at. Closed, because it lands in a column. */
export const ESTIMATED_BY = ["PRECO_DA_ORGANIZACAO"] as const;
export type EstimatedBy = (typeof ESTIMATED_BY)[number];

export type CreditDetails = {
  /** Cents, always. Integers this application computed, never provider text. */
  amountCents?: number;
  availableCents?: number;
};

const BUILDERS: Record<CreditReason, (details: CreditDetails) => string> = {
  PRECO_NAO_CONFIGURADO: () =>
    "Esta organização não tem preço de geração configurado. Defina-o em Organização → Créditos antes de gerar: sem preço não há quanto reservar, e gerar sem reservar é gastar sem saber quanto.",

  CONTA_NAO_ENCONTRADA: () =>
    "Esta organização ainda não tem conta de créditos. Ela é criada quando o primeiro aporte é registrado.",

  CONTA_BLOQUEADA: () =>
    "A conta de créditos está bloqueada e não aceita novas reservas. Resolva a conciliação pendente em Organização → Créditos.",

  SALDO_INSUFICIENTE: (d) =>
    `Não há saldo disponível suficiente para esta geração.${
      d.amountCents !== undefined ? ` Necessário: ${formatCents(d.amountCents)}.` : ""
    }${d.availableCents !== undefined ? ` Disponível: ${formatCents(d.availableCents)}.` : ""}`,

  TETO_MENSAL_ATINGIDO: () =>
    "Esta geração passaria do teto mensal da organização, contando o que já foi consumido e o que está comprometido em reservas vivas.",

  VALOR_INVALIDO: () =>
    "Um valor de crédito precisa ser um número inteiro de centavos, positivo. Nenhuma outra forma é aceita.",

  ORGANIZACAO_DIVERGENTE: () =>
    "A operação informada pertence a outra organização. Nenhuma reserva foi criada.",

  RESERVA_DUPLICADA: () =>
    "Já existe uma reserva para esta operação. A mesma operação não compromete crédito duas vezes.",

  CUSTO_ACIMA_DA_RESERVA: (d) =>
    `O custo real da geração passou do que estava reservado e não há saldo para cobrir a diferença.${
      d.amountCents !== undefined ? ` Custo: ${formatCents(d.amountCents)}.` : ""
    }${
      d.availableCents !== undefined ? ` Disponível: ${formatCents(d.availableCents)}.` : ""
    } A conta foi bloqueada e a reserva foi para conciliação: descontar o que não existe deixaria o saldo negativo, e ignorar a diferença faria a conta mentir.`,

  EFEITO_AMBIGUO_NA_GERACAO: () =>
    "A tentativa de início desta geração ficou em estado ambíguo: não é possível descartar que o provedor tenha sido chamado e cobrado. A reserva foi para conciliação com a conta bloqueada, em vez de ser liberada — liberar seria devolver dinheiro por um trabalho que pode ter acontecido.",

  RESERVA_NAO_LIQUIDAVEL: () =>
    "Esta reserva não está mais em RESERVADA e por isso não pode ser liquidada de novo. Uma reserva é consumida, liberada ou conciliada uma única vez.",
};

/** Cents to a readable amount. Never used for arithmetic — only for a message. */
function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export function buildCreditReasonMessage(
  reason: CreditReason,
  details: CreditDetails = {},
): string {
  return BUILDERS[reason](details);
}

/** The one refusal type the credit machinery raises. */
export class CreditRefusal extends Error {
  readonly reason: CreditReason;
  readonly details: CreditDetails;
  readonly code: CreditReason;

  constructor(reason: CreditReason, details: CreditDetails = {}) {
    super(buildCreditReasonMessage(reason, details));
    this.name = "CreditRefusal";
    this.reason = reason;
    this.details = details;
    this.code = reason;
  }
}

export function isCreditRefusal(error: unknown): error is CreditRefusal {
  return error instanceof CreditRefusal;
}

export function isCreditReason(value: unknown): value is CreditReason {
  return typeof value === "string" && (CREDIT_REASONS as readonly string[]).includes(value);
}

export function isLedgerMovement(value: unknown): value is LedgerMovement {
  return typeof value === "string" && (LEDGER_MOVEMENTS as readonly string[]).includes(value);
}

/**
 * How an amount was arrived at, from the closed set — checked at runtime as
 * well as in the type.
 *
 * The database holds the same list in a CHECK. This one guards the application
 * path; that one guards the script, the console and the data migration, which
 * is where unfamiliar values actually come from.
 */
export function assertEstimatedBy(value: unknown): asserts value is EstimatedBy {
  if (typeof value !== "string" || !(ESTIMATED_BY as readonly string[]).includes(value)) {
    throw new CreditRefusal("VALOR_INVALIDO");
  }
}

/**
 * Money is an integer number of cents, positive, and nothing else.
 *
 * Floats are the classic way to lose a cent per transaction and find out during
 * an audit, so nothing non-integral gets past this — including the values that
 * *look* like numbers and are not: `NaN`, `Infinity`, `1e21`.
 */
export function assertAmountCents(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 1_000_000_000
  ) {
    throw new CreditRefusal("VALOR_INVALIDO");
  }
}
