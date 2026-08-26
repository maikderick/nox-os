/**
 * How much of an integration is switched on.
 *
 * Everything starts at `DESLIGADO`, and moving further is an explicit, audited
 * decision. The ladder is deliberate: a fake proves the shape of the calls, a
 * sandbox proves the shape of the *answers*, and only then does real money and
 * real infrastructure enter the picture.
 */
export const INTEGRATION_MODES = ["DESLIGADO", "FALSO", "SANDBOX", "LIVE"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const INTEGRATION_PROVIDERS = ["github", "vercel", "cursor"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  github: "GitHub",
  vercel: "Vercel",
  cursor: "Cursor",
};

export const INTEGRATION_MODE_LABELS: Record<IntegrationMode, string> = {
  DESLIGADO: "Desligado",
  FALSO: "Falso",
  SANDBOX: "Sandbox",
  LIVE: "Live",
};

/**
 * `LIVE` is not selectable yet.
 *
 * The provisioning phase ends with the whole path exercised against fakes and
 * recorded fixtures; turning on a real provider is a separate, approved round.
 * Keeping the constant here — rather than scattering `!== "LIVE"` checks — means
 * the day it flips, there is exactly one place to change and one test to update.
 */
export const MODES_AVAILABLE: readonly IntegrationMode[] = ["DESLIGADO", "FALSO", "SANDBOX"];

/**
 * Cursor is in the vocabulary and nowhere else.
 *
 * It belongs to the phase that builds the durable queue and the credit ledger,
 * and a generation agent without either is an unbounded, unbilled spend. Keeping
 * the name while refusing every mode is deliberate: the domain can already talk
 * about it, and no one can switch it on by clicking.
 */
export const PROVIDERS_PENDING_PHASE: readonly IntegrationProvider[] = ["cursor"];

export function isProviderPending(provider: IntegrationProvider): boolean {
  return PROVIDERS_PENDING_PHASE.includes(provider);
}

/** What a given provider may be set to right now. */
export function modesAvailableFor(provider: IntegrationProvider): readonly IntegrationMode[] {
  return isProviderPending(provider) ? ["DESLIGADO"] : MODES_AVAILABLE;
}

export function isIntegrationMode(value: unknown): value is IntegrationMode {
  return typeof value === "string" && (INTEGRATION_MODES as readonly string[]).includes(value);
}

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return (
    typeof value === "string" && (INTEGRATION_PROVIDERS as readonly string[]).includes(value)
  );
}

export function isModeAvailable(mode: IntegrationMode, provider?: IntegrationProvider): boolean {
  return (provider ? modesAvailableFor(provider) : MODES_AVAILABLE).includes(mode);
}

/**
 * A kill switch that outranks the database.
 *
 * `NOX_INTEGRATIONS=disabled` forces every provider off for the whole
 * installation, whatever any organization has stored. It exists so an operator
 * can stop all outbound traffic without editing rows under pressure.
 */
export function environmentForcesDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.NOX_INTEGRATIONS ?? "").trim().toLowerCase() === "disabled";
}

/**
 * The mode that actually applies, given what is stored and what the environment
 * allows. Anything unrecognised — or a `LIVE` row written before `LIVE` is
 * supported — resolves to `DESLIGADO` rather than to something permissive.
 */
export function resolveIntegrationMode(
  storedMode: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  provider?: IntegrationProvider,
): IntegrationMode {
  if (environmentForcesDisabled(env)) return "DESLIGADO";
  if (!isIntegrationMode(storedMode)) return "DESLIGADO";
  if (!isModeAvailable(storedMode, provider)) return "DESLIGADO";
  return storedMode;
}
