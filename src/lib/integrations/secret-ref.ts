import "server-only";

import { createHash } from "node:crypto";

/**
 * Where a secret lives, never what it is.
 *
 * The database stores the environment variable's *name*, what the secret is
 * for, whose it is, and a fingerprint used only to notice a rotation. Reversing
 * a SHA-256 to the value is not possible, and nothing here ever logs it.
 */
export const SECRET_SCOPES = ["PLATAFORMA", "ORGANIZACAO"] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];

/**
 * The four credentials the provisioning phase needs. Two GitHub Apps, not one
 * with two hats: creating a repository is the most privileged act in the
 * factory, so it carries its own app id and its own private key.
 */
export const SECRET_PURPOSES = [
  "github.provisioner.appId",
  "github.provisioner.privateKey",
  "github.reconciler.appId",
  "github.reconciler.privateKey",
  "github.sitesOrg",
  "vercel.token",
] as const;
export type SecretPurpose = (typeof SECRET_PURPOSES)[number];

export const SECRET_PURPOSE_LABELS: Record<SecretPurpose, string> = {
  "github.provisioner.appId": "GitHub · Provisioner · App ID",
  "github.provisioner.privateKey": "GitHub · Provisioner · chave privada",
  "github.reconciler.appId": "GitHub · Reconciler · App ID",
  "github.reconciler.privateKey": "GitHub · Reconciler · chave privada",
  "github.sitesOrg": "GitHub · organização dos sites",
  "vercel.token": "Vercel · token de API",
};

export function isSecretPurpose(value: unknown): value is SecretPurpose {
  return typeof value === "string" && (SECRET_PURPOSES as readonly string[]).includes(value);
}

export type SecretRefRecord = {
  scope: string;
  organizationId: string | null;
  purpose: string;
  envVarName: string;
  fingerprint: string | null;
};

export class SecretUnavailableError extends Error {
  readonly purpose: string;
  readonly envVarName: string;

  constructor(purpose: string, envVarName: string) {
    super(
      `O segredo "${purpose}" não está disponível: defina a variável de ambiente ${envVarName}.`,
    );
    this.name = "SecretUnavailableError";
    this.purpose = purpose;
    this.envVarName = envVarName;
  }
}

function assertServerSide(): void {
  if (typeof window !== "undefined") {
    throw new Error("Segredos só podem ser resolvidos no servidor.");
  }
}

/** Detects rotation without being able to reconstruct the value. */
export function fingerprintSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Reads the value from the environment. It is returned to the caller and never
 * written anywhere: not to the database, not to a log, not to an audit entry.
 */
export function resolveSecret(
  ref: Pick<SecretRefRecord, "purpose" | "envVarName">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertServerSide();
  const value = env[ref.envVarName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SecretUnavailableError(ref.purpose, ref.envVarName);
  }
  return value;
}

export function canResolveSecret(
  ref: Pick<SecretRefRecord, "purpose" | "envVarName">,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    resolveSecret(ref, env);
    return true;
  } catch {
    return false;
  }
}

export type SecretRefStatus = {
  purpose: string;
  scope: string;
  envVarName: string;
  configured: boolean;
  /** True when the environment holds a different value than the one recorded. */
  rotated: boolean;
  lastRotatedAt: Date | null;
};

/**
 * A description safe to render or audit: it answers "is it set?" and "did it
 * change?" without ever carrying the secret itself.
 */
export function describeSecretRef(
  ref: SecretRefRecord & { lastRotatedAt?: Date | null },
  env: NodeJS.ProcessEnv = process.env,
): SecretRefStatus {
  const raw = env[ref.envVarName];
  const configured = typeof raw === "string" && raw.trim() !== "";

  return {
    purpose: ref.purpose,
    scope: ref.scope,
    envVarName: ref.envVarName,
    configured,
    rotated: Boolean(configured && ref.fingerprint && fingerprintSecret(raw) !== ref.fingerprint),
    lastRotatedAt: ref.lastRotatedAt ?? null,
  };
}
