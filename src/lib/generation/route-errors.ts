import { NextResponse } from "next/server";

import { authorizationResponse } from "@/lib/authz/route";
import { isCreditRefusal, type CreditReason } from "@/lib/credits/reasons";
import { describeJobError } from "@/lib/jobs/error-record";
import { isJobRefusal, type JobReason } from "@/lib/jobs/reasons";

import { isGenerationRefusal, type GenerationReason } from "./reasons";

/**
 * The status each refusal answers with.
 *
 * The interesting split is between `400`, `409` and `422`, and it is not
 * cosmetic: a client retries them differently. A malformed key is the caller's
 * to fix and never worth repeating; a conflict is about the world and may
 * resolve on its own; a reused key with a different body is a bug in the caller
 * that no retry will cure.
 */
const GENERATION_STATUS: Record<GenerationReason, number> = {
  CHAVE_DE_REQUISICAO_INVALIDA: 400,
  PROJETO_NAO_ELEGIVEL: 409,
  RUN_INEXISTENTE: 404,
  RUN_DE_OUTRA_ORGANIZACAO: 404,
  REPOSITORIO_NAO_PROVISIONADO: 409,
  HOSPEDAGEM_NAO_PROVISIONADA: 409,
  BRIEFING_AUSENTE: 409,
  PROVEDOR_NAO_CONFIGURADO: 409,
  EFEITO_AMBIGUO: 409,
  RECONCILIACAO_INDISPONIVEL: 409,
  REVISAO_AUSENTE: 409,
  COMMIT_AUSENTE: 409,
};

const JOB_STATUS: Partial<Record<JobReason, number>> = {
  CHAVE_EM_ANDAMENTO: 409,
  CORPO_DIVERGENTE: 409,
  CLASSIFICACAO_DIVERGENTE: 409,
  CHAVE_EM_CONCILIACAO: 409,
  EFEITO_EXTERNO_AMBIGUO: 409,
  TRABALHO_EM_ANDAMENTO: 409,
  ETAPA_ENFILEIRADA_CONCORRENTEMENTE: 409,
  POSSE_PERDIDA: 409,
};

/**
 * Money refusals are `402`, with two exceptions.
 *
 * `402 Payment Required` is exactly right for "there is not enough credit" and
 * exactly wrong for "this organization has no price configured", which is a
 * configuration problem an operator fixes, not a payment.
 */
const CREDIT_STATUS: Partial<Record<CreditReason, number>> = {
  PRECO_NAO_CONFIGURADO: 409,
  CONTA_NAO_ENCONTRADA: 409,
  CONTA_BLOQUEADA: 409,
  SALDO_INSUFICIENTE: 402,
  TETO_MENSAL_ATINGIDO: 402,
  VALOR_INVALIDO: 400,
  ORGANIZACAO_DIVERGENTE: 403,
  RESERVA_DUPLICADA: 409,
  CUSTO_ACIMA_DA_RESERVA: 409,
  EFEITO_AMBIGUO_NA_GERACAO: 409,
  RESERVA_NAO_LIQUIDAVEL: 409,
};

/**
 * The HTTP boundary of the generation chain, and the last place an error can
 * escape.
 *
 * Nothing is re-thrown. An unrecognised error reaching Next would be logged by
 * the framework with its message and its stack intact — the one path that
 * survives every other precaution — so it stops here and leaves with a
 * correlation id and nothing else.
 */
export async function withGenerationErrors<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;

    if (isGenerationRefusal(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: GENERATION_STATUS[error.reason] },
      );
    }

    if (isJobRefusal(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: JOB_STATUS[error.reason] ?? 409 },
      );
    }

    if (isCreditRefusal(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: CREDIT_STATUS[error.reason] ?? 409 },
      );
    }

    const stored = describeJobError(error, { step: "generation.request" });
    return NextResponse.json(
      { error: stored.message, code: stored.code, correlationId: stored.correlationId },
      { status: 500 },
    );
  }
}
