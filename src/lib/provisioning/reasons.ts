/**
 * Every refusal this phase can express, and the only text that may be stored.
 *
 * `instanceof` is not enough to trust a message: `ProviderPreflightError` and its
 * siblings accept arbitrary strings, so a provider response could reach the
 * database simply by being wrapped in one of our own classes. Messages are built
 * here instead — from a closed set of reasons plus fields the factory itself
 * produced — and the free text on an `Error` is for a developer reading a stack
 * trace, never for a column.
 */

export const PROVISIONING_REASONS = [
  "SEM_AUTORIZACAO",
  "INTEGRACAO_DESLIGADA",
  "MODO_INDISPONIVEL",
  "PROVEDOR_NAO_CONFIGURADO",
  "PROJETO_NAO_ELEGIVEL",
  "BRIEFING_VERSAO_ANTIGA",
  "BRIEFING_ADULTERADO",
  "SNAPSHOT_INVALIDO",
  "NOME_OCUPADO_POR_OUTRO_PROJETO",
  "RECURSO_DE_TERCEIRO",
  "PROVENIENCIA_NAO_COMPROVADA",
  "REPOSITORIO_INCOMPLETO",
  "CONTEUDO_NAO_PUBLICADO",
  "HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO",
  "HOSPEDAGEM_INCOMPLETA",
  "HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO",
] as const;

export type ProvisioningReason = (typeof PROVISIONING_REASONS)[number];

/**
 * Fields that may appear in a stored message.
 *
 * Every one is a value this application produced: a name it derived from a
 * client slug, a state from its own enum, a mode from its own enum. Nothing
 * here is ever copied from a provider response — a repository name returned by
 * GitHub matches the same character class a token does, so echoing "what we
 * found" is exactly the mistake this type exists to prevent.
 */
export type SafeDetails = {
  provider?: "github" | "vercel" | "cursor";
  owner?: string;
  repository?: string;
  project?: string;
  state?: string;
  mode?: string;
  /** Field paths from our own snapshot contract, never provider text. */
  fields?: string[];
};

const BUILDERS: Record<ProvisioningReason, (details: SafeDetails) => string> = {
  SEM_AUTORIZACAO: () => "Você não tem autorização para esta ação.",

  INTEGRACAO_DESLIGADA: (d) =>
    `A integração com ${d.provider ?? "o provedor"} está desligada. Ligue-a em Organização → Integrações antes de tentar de novo.`,

  MODO_INDISPONIVEL: (d) =>
    `O modo ${d.mode ?? "solicitado"} não está disponível nesta fase para ${d.provider ?? "este provedor"}.`,

  PROVEDOR_NAO_CONFIGURADO: (d) =>
    `As credenciais de ${d.provider ?? "provedor"} não estão completas. Verifique as variáveis de ambiente em Organização → Integrações.`,

  PROJETO_NAO_ELEGIVEL: (d) =>
    `O projeto precisa estar em "Briefing pronto" para ser provisionado.${
      d.state ? ` Estado atual: ${d.state}.` : ""
    }`,

  BRIEFING_VERSAO_ANTIGA: () =>
    "Este projeto tem um briefing v1, que guarda apenas o nome de cada serviço. Crie uma versão v2 confirmando resumo, conteúdo e contato antes de provisionar.",

  BRIEFING_ADULTERADO: () =>
    "O briefing armazenado não confere com a impressão digital confirmada. Confirme o briefing de novo antes de provisionar.",

  SNAPSHOT_INVALIDO: (d) =>
    `O snapshot não passa no contrato do site.${
      d.fields?.length ? ` Campos: ${d.fields.join(", ")}.` : ""
    }`,

  NOME_OCUPADO_POR_OUTRO_PROJETO: (d) =>
    `O nome ${d.owner ? `${d.owner}/` : ""}${d.repository ?? d.project ?? ""} já pertence a outro projeto no NOX OS. Renomeie o cliente.`,

  RECURSO_DE_TERCEIRO: (d) =>
    `${d.repository ? `O repositório ${d.owner}/${d.repository}` : `O projeto ${d.project}`} já existe e não foi criado pelo NOX OS. Escolha outro nome para o cliente ou mova o recurso existente.`,

  PROVENIENCIA_NAO_COMPROVADA: (d) =>
    `${
      d.repository ? `O repositório ${d.owner}/${d.repository}` : `O projeto ${d.project}`
    } existe, mas não foi possível comprovar que o NOX OS o criou. Confira o recurso manualmente e, se ele for realmente deste projeto, remova-o ou renomeie o cliente antes de tentar de novo.`,

  REPOSITORIO_INCOMPLETO: () =>
    "O repositório ainda não está pronto. Conclua a etapa 1 antes desta.",

  CONTEUDO_NAO_PUBLICADO: () =>
    "O conteúdo ainda não foi publicado no repositório. Conclua a etapa 2 antes desta.",

  HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO: (d) =>
    `A instalação da Vercel ainda não enxerga ${d.owner}/${d.repository}. Autorize o repositório na instalação do GitHub da Vercel e tente de novo.`,

  HOSPEDAGEM_INCOMPLETA: () =>
    "O projeto de hospedagem ainda não está pronto. Conclua a etapa 3 antes desta.",

  HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO: (d) =>
    `O projeto de hospedagem ${d.project} está ligado a outro repositório. Não é seguro aplicar variáveis nele; confira o projeto manualmente.`,
};

export function buildReasonMessage(
  reason: ProvisioningReason,
  details: SafeDetails = {},
): string {
  return BUILDERS[reason](details);
}

/**
 * The one refusal type the provisioning code raises.
 *
 * Its message is built from the reason, so what a developer reads in a stack
 * trace and what lands in a column are the same safe text.
 */
export class ProvisioningRefusal extends Error {
  readonly reason: ProvisioningReason;
  readonly details: SafeDetails;
  /** Kept for the API contract, which already speaks in these codes. */
  readonly code: ProvisioningReason;

  constructor(reason: ProvisioningReason, details: SafeDetails = {}) {
    super(buildReasonMessage(reason, details));
    this.name = "ProvisioningRefusal";
    this.reason = reason;
    this.details = details;
    this.code = reason;
  }
}

export function isProvisioningRefusal(error: unknown): error is ProvisioningRefusal {
  return error instanceof ProvisioningRefusal;
}
