import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { AuthorizationError } from "@/lib/authz/errors";

import {
  buildReasonMessage,
  isProvisioningRefusal,
  type ProvisioningReason,
} from "./reasons";

/**
 * What may be written down about a failure — anywhere.
 *
 * A denylist of secret-shaped patterns only catches the shapes someone thought
 * of. `instanceof` is no better on its own: `ProviderPreflightError` and its
 * siblings accept arbitrary strings, so a provider response reaches a column
 * simply by being wrapped in one of our own classes on the way out.
 *
 * So nothing is ever copied. A stored message is *rebuilt* from a closed reason
 * and fields this application produced, and an error that carries no reason
 * keeps none of its text — not in the database, not in the response, not in the
 * log.
 */
export type StoredError = {
  code: string;
  message: string;
  /** Present only when the original was withheld entirely. */
  correlationId?: string;
};

export const UNKNOWN_ERROR_CODE = "ERRO_INESPERADO";

const GENERIC_MESSAGE =
  "A etapa falhou por um erro inesperado. O detalhe técnico não é gravado nem registrado; use o código de correlação para localizar a ocorrência.";

/**
 * How an unrecognised failure is classified for the log.
 *
 * A closed set, on purpose. Even a class name is a string from somewhere, and
 * "somewhere" eventually includes a library that puts a URL in it.
 */
type Classification = "banco" | "tipo-inesperado" | "desconhecido";

function classify(error: unknown): Classification {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return "banco";
  }
  if (!(error instanceof Error)) return "tipo-inesperado";
  return "desconhecido";
}

/**
 * Authorization failures have fixed messages, but they are rebuilt rather than
 * read: the constructor is public, so trusting `.message` would trust whatever
 * a future caller passes it.
 */
function authorizationReason(): ProvisioningReason {
  return "SEM_AUTORIZACAO";
}

export function describeErrorForStorage(
  error: unknown,
  options: { step?: string; log?: (line: string) => void } = {},
): StoredError {
  const log = options.log ?? console.error;

  if (isProvisioningRefusal(error)) {
    // Rebuilt from the reason, not copied from the instance: the message and the
    // details are both ours by construction.
    return {
      code: error.reason,
      message: buildReasonMessage(error.reason, error.details),
    };
  }

  if (error instanceof AuthorizationError) {
    const reason = authorizationReason();
    return { code: reason, message: buildReasonMessage(reason) };
  }

  const correlationId = randomUUID();

  // The log line carries no part of the original either. A message that is
  // unsafe for a column is unsafe for a log file that gets shipped, indexed and
  // read by more people than the database ever is.
  log(
    `[provisionamento] correlacao=${correlationId} etapa=${options.step ?? "desconhecida"} classe=${classify(error)}`,
  );

  return { code: UNKNOWN_ERROR_CODE, message: GENERIC_MESSAGE, correlationId };
}

/** The single line stored in `SiteProvisioning.lastError`. */
export function formatStoredError(stored: StoredError): string {
  return stored.correlationId
    ? `${stored.message} (código de correlação: ${stored.correlationId})`
    : stored.message;
}
