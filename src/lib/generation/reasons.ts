/**
 * Every refusal the generation chain can express, and the only text it stores.
 *
 * The same rule as `jobs/reasons.ts` and `provisioning/reasons.ts`, for the
 * same reason: a message is *rebuilt* from a closed set plus values this
 * application produced, never copied from an object a provider constructed.
 * These end up in `Job.lastError` and on a screen an operator reads while
 * deciding whether to spend money again.
 */

export const GENERATION_REASONS = [
  "PROJETO_NAO_ELEGIVEL",
  "CHAVE_DE_REQUISICAO_INVALIDA",
  "RUN_INEXISTENTE",
  "RUN_DE_OUTRA_ORGANIZACAO",
  "REPOSITORIO_NAO_PROVISIONADO",
  "HOSPEDAGEM_NAO_PROVISIONADA",
  "BRIEFING_AUSENTE",
  "PROVEDOR_NAO_CONFIGURADO",
  "EFEITO_AMBIGUO",
  "RECONCILIACAO_INDISPONIVEL",
  "REVISAO_AUSENTE",
  "COMMIT_AUSENTE",
] as const;

export type GenerationReason = (typeof GENERATION_REASONS)[number];

const BUILDERS: Record<GenerationReason, () => string> = {
  PROJETO_NAO_ELEGIVEL: () =>
    "Este projeto não está num estado a partir do qual a máquina de estados autorize gerar. Outra geração pode ter começado neste instante, ou o projeto está numa etapa que não permite gerar.",

  CHAVE_DE_REQUISICAO_INVALIDA: () =>
    "O cabeçalho Idempotency-Key é obrigatório e precisa ser um UUID. Ele é o que distingue uma retentativa de rede de um segundo pedido deliberado — e só quem chamou sabe a diferença.",

  RUN_INEXISTENTE: () =>
    "A geração referida por este job não existe. Um job de geração sem run é erro de programação, não uma condição a ser repetida.",

  RUN_DE_OUTRA_ORGANIZACAO: () =>
    "A geração referida pertence a outra organização. Nada foi executado.",

  REPOSITORIO_NAO_PROVISIONADO: () =>
    "Este projeto ainda não tem repositório provisionado. O agente precisa de exatamente um repositório para trabalhar, e ele é criado no provisionamento.",

  HOSPEDAGEM_NAO_PROVISIONADA: () =>
    "Este projeto ainda não tem projeto de hospedagem. Sem ele não há prévia a observar.",

  BRIEFING_AUSENTE: () =>
    "Este projeto não tem briefing confirmado. Gerar sem briefing seria pedir ao agente que inventasse os fatos do negócio.",

  PROVEDOR_NAO_CONFIGURADO: () =>
    "O provedor de geração não está configurado para esta organização. Nenhuma chamada foi feita e nenhum crédito foi comprometido.",

  EFEITO_AMBIGUO: () =>
    "Não é possível descartar que o provedor tenha sido chamado nesta tentativa. A geração foi para conciliação em vez de ser repetida às cegas: repetir poderia duplicar um trabalho já pago.",

  RECONCILIACAO_INDISPONIVEL: () =>
    "O provedor não sabe repetir com segurança nem consultar execuções por chave, e a tentativa anterior ficou ambígua. Só uma pessoa pode decidir daqui.",

  REVISAO_AUSENTE: () =>
    "A revisão que este observador deveria examinar não existe. Ela é criada quando o agente conclui, e sem ela não há fato a gravar.",

  COMMIT_AUSENTE: () =>
    "O agente concluiu sem informar o commit produzido. Sem commit não há o que verificar, e a barreira não teria como comparar os três fatos.",
};

export function buildGenerationReasonMessage(reason: GenerationReason): string {
  return BUILDERS[reason]();
}

/** The one refusal type the generation chain raises. */
export class GenerationRefusal extends Error {
  readonly reason: GenerationReason;
  readonly code: GenerationReason;

  constructor(reason: GenerationReason) {
    super(buildGenerationReasonMessage(reason));
    this.name = "GenerationRefusal";
    this.reason = reason;
    this.code = reason;
  }
}

export function isGenerationRefusal(error: unknown): error is GenerationRefusal {
  return error instanceof GenerationRefusal;
}

export function isGenerationReason(value: unknown): value is GenerationReason {
  return typeof value === "string" && (GENERATION_REASONS as readonly string[]).includes(value);
}
