import "server-only";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import type { IntegrationMode } from "@/lib/integrations/modes";

import type { GitRepositoryProvider, HostingProvider } from "@/lib/providers/ports";
import { getGitRepositoryProvider, getHostingProvider } from "@/lib/providers/registry";

import { assertProvisioningEligible, type EligibleBrief } from "./eligibility";
import { SanitizedProvisioningFailure } from "./error-record";
import { ProvisioningRefusal } from "./reasons";
import { sitesOwnerFallback } from "./naming";
import { loadProvisionableProject, recordStepFailure, type ProvisioningStep } from "./state";

export type ProvisioningContext = {
  actor: Actor;
  project: Awaited<ReturnType<typeof loadProvisionableProject>>;
  mode: IntegrationMode;
  /** The parsed, verified v2 brief. Steps never re-read or re-parse it. */
  eligible: EligibleBrief;
};

/**
 * Everything a step needs before it is allowed to act: the caller may run
 * provisioning, the project belongs to their organization, and the integration
 * is actually on.
 */
export async function openProvisioningContext(params: {
  actor: Actor;
  siteProjectId: string;
  provider: "github" | "vercel";
}): Promise<ProvisioningContext> {
  assertPermission(params.actor, "provisioning:run");

  const project = await loadProvisionableProject(params.actor, params.siteProjectId);
  const mode = await getEffectiveMode(params.actor.organizationId, params.provider);
  if (mode === "DESLIGADO") {
    throw new ProvisioningRefusal("INTEGRACAO_DESLIGADA", { provider: params.provider });
  }

  // The last gate before any provider is reachable. Every step opens its
  // context through here, so eligibility cannot be skipped by adding a step.
  const eligible = assertProvisioningEligible(project);

  return { actor: params.actor, project, mode, eligible };
}

export async function gitProviderFor(context: ProvisioningContext): Promise<GitRepositoryProvider> {
  const provider = getGitRepositoryProvider(context.mode);
  if (!(await provider.isConfigured())) {
    throw new ProvisioningRefusal("PROVEDOR_NAO_CONFIGURADO", { provider: "github" });
  }
  return provider;
}

export async function hostingProviderFor(context: ProvisioningContext): Promise<HostingProvider> {
  const provider = getHostingProvider(context.mode);
  if (!(await provider.isConfigured())) {
    throw new ProvisioningRefusal("PROVEDOR_NAO_CONFIGURADO", { provider: "vercel" });
  }
  return provider;
}

/**
 * The GitHub organization that holds only generated sites.
 *
 * Keeping client sites away from the repositories that run the factory means
 * the privileged App's blast radius is an organization containing nothing else.
 */
export async function resolveSitesOwner(context: ProvisioningContext): Promise<string> {
  // An organization may name its own destination; otherwise the platform one
  // applies. Ordering by scope makes the org-specific row win when both exist.
  const ref = await prisma.secretRef.findFirst({
    where: {
      purpose: "github.sitesOrg",
      OR: [
        { scope: "ORGANIZACAO", organizationId: context.actor.organizationId },
        { scope: "PLATAFORMA", organizationId: null },
      ],
    },
    orderBy: { scope: "asc" },
    select: { envVarName: true },
  });

  const fromEnv = ref ? process.env[ref.envVarName] : undefined;
  const owner = (fromEnv ?? sitesOwnerFallback()).trim();
  if (!owner) {
    throw new ProvisioningRefusal("PROVEDOR_NAO_CONFIGURADO", { provider: "github" });
  }
  return owner;
}

/**
 * Runs a step, recording the failure before letting it through.
 *
 * The recording matters: without it a failed run leaves no trace on the screen
 * the operator is looking at, and the only evidence lives in a log they cannot
 * reach.
 *
 * What travels onward is never the original object. A refusal this application
 * built is safe by construction and continues as itself; anything else is
 * replaced by a sanitized failure carrying the same correlation id that reached
 * the column. Re-throwing the original would have kept the database clean and
 * handed the message and the stack to the framework, which logs both.
 */
export async function runStep<T>(
  params: { siteProjectId: string; step: ProvisioningStep },
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const stored = await recordStepFailure({
      siteProjectId: params.siteProjectId,
      step: params.step,
      error,
    });

    // A correlation id is only minted when nothing of the original could be
    // kept, which is exactly the case that must not travel.
    if (stored.correlationId) {
      throw new SanitizedProvisioningFailure(stored, params.step);
    }

    throw error;
  }
}
