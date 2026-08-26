import "server-only";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/settings";

import {
  INTEGRATION_PROVIDERS,
  isModeAvailable,
  isProviderPending,
  modesAvailableFor,
  resolveIntegrationMode,
  type IntegrationMode,
  type IntegrationProvider,
} from "./modes";
import {
  describeSecretRef,
  type SecretRefStatus,
} from "./secret-ref";

export class IntegrationModeNotAvailableError extends Error {
  readonly code = "MODO_INDISPONIVEL";
  readonly mode: IntegrationMode;

  constructor(mode: IntegrationMode, provider?: IntegrationProvider) {
    super(
      provider && isProviderPending(provider)
        ? `O provedor ${provider} não é operável nesta fase: ele depende da fila durável e do controle de créditos. Nenhum modo além de DESLIGADO é aceito.`
        : `O modo ${mode} não está disponível nesta fase. Ligar um provedor real é uma decisão separada, aprovada e auditada.`,
    );
    this.name = "IntegrationModeNotAvailableError";
    this.mode = mode;
  }
}

export type IntegrationStatus = {
  provider: IntegrationProvider;
  /** What the organization asked for. */
  storedMode: IntegrationMode;
  /** What actually applies, after the environment kill switch. */
  effectiveMode: IntegrationMode;
  forcedOffByEnvironment: boolean;
  /** What this provider may be set to right now. */
  availableModes: readonly IntegrationMode[];
  /** True while the provider belongs to a phase that has not happened yet. */
  pendingPhase: boolean;
  enabledAt: Date | null;
  secrets: SecretRefStatus[];
};

const SECRETS_BY_PROVIDER: Record<IntegrationProvider, readonly string[]> = {
  github: [
    "github.provisioner.appId",
    "github.provisioner.privateKey",
    "github.reconciler.appId",
    "github.reconciler.privateKey",
    "github.sitesOrg",
  ],
  vercel: ["vercel.token"],
  cursor: [],
};

/**
 * Reports every provider, whichever rows exist. A provider with no row is not a
 * gap to fix — it is simply off, which is the default.
 */
export async function listIntegrations(actor: Actor): Promise<IntegrationStatus[]> {
  assertPermission(actor, "org:read");

  const [settings, refs] = await Promise.all([
    prisma.integrationSetting.findMany({
      where: { organizationId: actor.organizationId },
    }),
    prisma.secretRef.findMany({
      where: {
        OR: [
          { scope: "PLATAFORMA", organizationId: null },
          { scope: "ORGANIZACAO", organizationId: actor.organizationId },
        ],
      },
    }),
  ]);

  const byProvider = new Map(settings.map((setting) => [setting.provider, setting]));

  return INTEGRATION_PROVIDERS.map((provider) => {
    const setting = byProvider.get(provider);
    const stored = (setting?.mode ?? "DESLIGADO") as IntegrationMode;
    const purposes = SECRETS_BY_PROVIDER[provider];

    return {
      provider,
      storedMode: stored,
      effectiveMode: resolveIntegrationMode(stored, process.env, provider),
      forcedOffByEnvironment: resolveIntegrationMode(stored, process.env, provider) !== stored,
      availableModes: modesAvailableFor(provider),
      pendingPhase: isProviderPending(provider),
      enabledAt: setting?.enabledAt ?? null,
      secrets: refs
        .filter((ref) => purposes.includes(ref.purpose))
        .map((ref) => describeSecretRef(ref)),
    };
  });
}

/** The mode a provider runs in right now, for the services that need to decide. */
export async function getEffectiveMode(
  organizationId: string,
  provider: IntegrationProvider,
): Promise<IntegrationMode> {
  const setting = await prisma.integrationSetting.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: { mode: true },
  });
  return resolveIntegrationMode(setting?.mode, process.env, provider);
}

export async function setIntegrationMode(params: {
  actor: Actor;
  provider: IntegrationProvider;
  mode: IntegrationMode;
}): Promise<IntegrationStatus> {
  assertPermission(params.actor, "integration:manage");
  if (!isModeAvailable(params.mode, params.provider)) {
    throw new IntegrationModeNotAvailableError(params.mode, params.provider);
  }

  const key = {
    organizationId_provider: {
      organizationId: params.actor.organizationId,
      provider: params.provider,
    },
  };
  const enabling = params.mode !== "DESLIGADO";

  // The change and its record commit together. A mode change that landed with no
  // audit entry, or an entry for a change that rolled back, are both worse than
  // either operation failing: an incident review could not tell them apart.
  await prisma.$transaction(async (tx) => {
    const previous = await tx.integrationSetting.findUnique({
      where: key,
      select: { mode: true },
    });

    await tx.integrationSetting.upsert({
      where: key,
      create: {
        organizationId: params.actor.organizationId,
        provider: params.provider,
        mode: params.mode,
        enabledById: enabling ? params.actor.userId : null,
        enabledAt: enabling ? new Date() : null,
      },
      update: {
        mode: params.mode,
        enabledById: enabling ? params.actor.userId : null,
        enabledAt: enabling ? new Date() : null,
      },
    });

    // Before and after, with the actor: turning an integration on is exactly the
    // kind of change a review has to be able to reconstruct.
    await writeAudit({
      db: tx,
      userId: params.actor.userId,
      action: "integration.mode.update",
      entity: "IntegrationSetting",
      entityId: `${params.actor.organizationId}:${params.provider}`,
      meta: {
        provider: params.provider,
        from: previous?.mode ?? "DESLIGADO",
        to: params.mode,
      },
    });
  });

  const statuses = await listIntegrations(params.actor);
  return statuses.find((status) => status.provider === params.provider)!;
}
