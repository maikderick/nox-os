import { randomUUID } from "node:crypto";

import { AuthorizationError } from "@/lib/authz/errors";
import {
  IntegrationDisabledError,
  IntegrationModeUnsupportedError,
  ProviderPreflightError,
  ProviderResourceConflictError,
  ProviderResourceNotFoundError,
} from "@/lib/providers/errors";

import { ProvisioningNotEligibleError } from "./eligibility";

/**
 * What may be written down about a failure.
 *
 * The previous approach was a denylist of things that look like secrets, which
 * is a losing game: it only catches the shapes someone thought of, and a
 * provider that invents a new token format leaks by default. This is an
 * allowlist instead — a message is stored only when this application composed
 * it, from its own data, and everything else is replaced.
 */
export type StoredError = {
  code: string;
  message: string;
  /** Present only when the original was withheld. */
  correlationId?: string;
};

export const UNKNOWN_ERROR_CODE = "ERRO_INESPERADO";

const GENERIC_MESSAGE =
  "A etapa falhou por um erro inesperado. O detalhe técnico não é gravado; use o código de correlação para localizá-lo no log do servidor.";

/**
 * Errors this application constructs itself.
 *
 * Every one of them builds its message from literals plus data the factory
 * already owns — an owner, a repository name, a project state. None of them ever
 * embeds a provider response, which is what makes them safe to store verbatim.
 */
const ALLOWED_ERRORS = [
  AuthorizationError,
  IntegrationDisabledError,
  IntegrationModeUnsupportedError,
  ProviderPreflightError,
  ProviderResourceConflictError,
  ProviderResourceNotFoundError,
  ProvisioningNotEligibleError,
] as const;

function isAllowed(error: unknown): error is Error & { code?: string } {
  return ALLOWED_ERRORS.some((candidate) => error instanceof candidate);
}

/**
 * Reduces any thrown value to something safe to persist.
 *
 * An unrecognised error keeps nothing of its original text. The raw message goes
 * to the server log next to the correlation id, so debugging stays possible
 * without the database becoming the place a leaked token comes to rest.
 */
export function describeErrorForStorage(
  error: unknown,
  log: (message: string) => void = console.error,
): StoredError {
  if (isAllowed(error)) {
    return {
      code: error.code ?? UNKNOWN_ERROR_CODE,
      message: error.message,
    };
  }

  const correlationId = randomUUID();
  const original = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  log(`[provisionamento] ${correlationId} ${original}`);

  return { code: UNKNOWN_ERROR_CODE, message: GENERIC_MESSAGE, correlationId };
}

/** The single line stored in `SiteProvisioning.lastError`. */
export function formatStoredError(stored: StoredError): string {
  return stored.correlationId
    ? `${stored.message} (código de correlação: ${stored.correlationId})`
    : stored.message;
}
