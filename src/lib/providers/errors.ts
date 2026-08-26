import type { IntegrationMode, IntegrationProvider } from "@/lib/integrations/modes";

/** Refusals a provider raises, each with a stable code a client can branch on. */
export const PROVIDER_ERROR_CODES = {
  disabled: "INTEGRACAO_DESLIGADA",
  modeUnavailable: "MODO_INDISPONIVEL",
  notFound: "RECURSO_INEXISTENTE",
  conflict: "RECURSO_JA_EXISTE",
  preflightFailed: "PREFLIGHT_FALHOU",
} as const;

export class IntegrationDisabledError extends Error {
  readonly code = PROVIDER_ERROR_CODES.disabled;
  readonly provider: IntegrationProvider;

  constructor(provider: IntegrationProvider) {
    super(
      `A integração com ${provider} está desligada. Ligue-a em Organização → Integrações antes de tentar de novo.`,
    );
    this.name = "IntegrationDisabledError";
    this.provider = provider;
  }
}

export class IntegrationModeUnsupportedError extends Error {
  readonly code = PROVIDER_ERROR_CODES.modeUnavailable;

  constructor(provider: IntegrationProvider, mode: IntegrationMode) {
    super(`O modo ${mode} ainda não está implementado para ${provider}.`);
    this.name = "IntegrationModeUnsupportedError";
  }
}

export class ProviderResourceNotFoundError extends Error {
  readonly code = PROVIDER_ERROR_CODES.notFound;

  constructor(what: string) {
    super(`${what} não foi encontrado.`);
    this.name = "ProviderResourceNotFoundError";
  }
}

export class ProviderResourceConflictError extends Error {
  readonly code = PROVIDER_ERROR_CODES.conflict;

  constructor(what: string) {
    super(`${what} já existe.`);
    this.name = "ProviderResourceConflictError";
  }
}

export class ProviderPreflightError extends Error {
  readonly code = PROVIDER_ERROR_CODES.preflightFailed;

  constructor(message: string) {
    super(message);
    this.name = "ProviderPreflightError";
  }
}
