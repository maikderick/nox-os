import "server-only";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";
import { ProviderResourceConflictError } from "@/lib/providers/errors";
import { writeAudit } from "@/lib/settings";

import {
  gitProviderFor,
  openProvisioningContext,
  resolveSitesOwner,
  runStep,
} from "./context";
import { REQUIRED_CHECK, SITE_TEMPLATE, repositoryNameFor } from "./naming";
import { ensureProvisioning, recordStepSuccess } from "./state";

export type RepositoryStepResult = {
  repository: {
    owner: string;
    name: string;
    url: string | null;
    externalId: string | null;
    defaultBranch: string;
    protectedAt: Date | null;
  };
  /** True when this call found the work already done. */
  alreadyDone: boolean;
};

/**
 * Step 1 — create the client's repository from the template and protect it.
 *
 * Idempotent by checking what exists first: a repository row for the project is
 * the record that the step succeeded, so pressing the button again reports the
 * same result instead of trying to create a second repository.
 */
export async function provisionRepository(params: {
  actor: Actor;
  siteProjectId: string;
}): Promise<RepositoryStepResult> {
  const context = await openProvisioningContext({
    actor: params.actor,
    siteProjectId: params.siteProjectId,
    provider: "github",
  });

  await ensureProvisioning(params.siteProjectId);

  return runStep({ siteProjectId: params.siteProjectId, step: "repository" }, async () => {
    const existing = context.project.repository;
    if (existing) {
      return {
        repository: {
          owner: existing.owner,
          name: existing.name,
          url: existing.url,
          externalId: existing.externalId,
          defaultBranch: existing.defaultBranch,
          protectedAt: existing.protectedAt,
        },
        alreadyDone: true,
      };
    }

    const provider = await gitProviderFor(context);
    const owner = await resolveSitesOwner(context);
    const name = repositoryNameFor(context.project.client.slug);

    // The client slug is unique per organization, not across the whole host, so
    // availability is checked rather than assumed.
    const taken = await provider.getRepository({ owner, name });
    if (taken) {
      throw new ProviderResourceConflictError(
        `O repositório ${owner}/${name}. Escolha outro nome para o cliente ou mova o repositório existente`,
      );
    }

    const repo = await provider.createFromTemplate({
      owner,
      name,
      templateOwner: SITE_TEMPLATE.owner,
      templateRepo: SITE_TEMPLATE.repo,
    });

    // Protection asks for `verify` and nothing else: the other names are steps
    // inside that job and never appear as checks.
    await provider.protectDefaultBranch({ repo, requiredChecks: [REQUIRED_CHECK] });
    const protectedAt = new Date();

    const stored = await prisma.repository.create({
      data: {
        organizationId: context.actor.organizationId,
        siteProjectId: context.project.id,
        provider: "github",
        owner: repo.owner,
        name: repo.name,
        externalId: repo.externalId,
        url: repo.url,
        defaultBranch: repo.defaultBranch,
        protectedAt,
      },
    });

    await recordStepSuccess({ siteProjectId: context.project.id, step: "repository" });

    await writeAudit({
      userId: context.actor.userId,
      action: "provisioning.repository.create",
      entity: "Repository",
      entityId: stored.id,
      meta: {
        mode: context.mode,
        owner: repo.owner,
        name: repo.name,
        requiredChecks: [REQUIRED_CHECK],
      },
    });

    return {
      repository: {
        owner: stored.owner,
        name: stored.name,
        url: stored.url,
        externalId: stored.externalId,
        defaultBranch: stored.defaultBranch,
        protectedAt: stored.protectedAt,
      },
      alreadyDone: false,
    };
  });
}
