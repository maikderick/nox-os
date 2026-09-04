import { NextResponse } from "next/server";

import { authorizationResponse } from "@/lib/authz/route";

import {
  describeErrorForStorage,
  isSanitizedFailure,
  type StoredError,
} from "./error-record";
import { isProvisioningRefusal, type ProvisioningReason } from "./reasons";

/**
 * The status each refusal answers with.
 *
 * All of them are conflicts in the plain sense: the request is well formed and
 * the caller is allowed, but the world is not in a state where the action means
 * anything.
 */
const STATUS_BY_REASON: Record<ProvisioningReason, number> = {
  SEM_AUTORIZACAO: 403,
  INTEGRACAO_DESLIGADA: 409,
  MODO_INDISPONIVEL: 409,
  PROVEDOR_NAO_CONFIGURADO: 409,
  PROJETO_NAO_ELEGIVEL: 409,
  BRIEFING_VERSAO_ANTIGA: 409,
  BRIEFING_ADULTERADO: 409,
  SNAPSHOT_INVALIDO: 409,
  NOME_OCUPADO_POR_OUTRO_PROJETO: 409,
  RECURSO_DE_TERCEIRO: 409,
  PROVENIENCIA_NAO_COMPROVADA: 409,
  REPOSITORIO_INCOMPLETO: 409,
  CONTEUDO_NAO_PUBLICADO: 409,
  HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO: 409,
  HOSPEDAGEM_INCOMPLETA: 409,
  HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO: 409,
};

/**
 * Turns a refusal into the response it describes.
 *
 * The body is produced by the same function that writes the database column, so
 * the client and the audit trail can never disagree — and neither can carry text
 * this application did not compose. Anything unrecognised returns null and
 * reaches the client as a bare 500, with the detail nowhere but a correlation
 * id.
 */
export function provisioningErrorResponse(error: unknown): NextResponse | null {
  if (!isProvisioningRefusal(error)) return null;

  const stored = describeErrorForStorage(error);
  return NextResponse.json(
    { error: stored.message, code: stored.code },
    { status: STATUS_BY_REASON[error.reason] },
  );
}

function answerUnexpected(stored: StoredError): NextResponse {
  return NextResponse.json(
    {
      error: stored.message,
      code: stored.code,
      correlationId: stored.correlationId,
    },
    { status: 500 },
  );
}

/**
 * The HTTP boundary, and the last place an error can escape.
 *
 * Nothing is re-thrown. An unrecognised error reaching Next would be logged by
 * the framework with its message and stack intact, which is the one path that
 * survives every other precaution — so it stops here, described safely, whether
 * it came from a step that already recorded it or from anywhere before that.
 */
export async function withProvisioningErrors<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;

    const refused = provisioningErrorResponse(error);
    if (refused) return refused;

    // Already recorded by `runStep`: reuse its correlation id rather than
    // describing the failure again and minting a second one.
    if (isSanitizedFailure(error)) {
      return answerUnexpected({
        code: error.code,
        message: error.message,
        correlationId: error.correlationId,
      });
    }

    // Never reached a step — a failure while loading the project, resolving the
    // mode, or anywhere else before `runStep`. Same treatment.
    return answerUnexpected(describeErrorForStorage(error));
  }
}
