import "server-only";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";
import { ProviderPreflightError } from "@/lib/providers/errors";
import { writeAudit } from "@/lib/settings";

import { hostingProviderFor, openProvisioningContext, runStep } from "./context";
import { hostingProjectNameFor } from "./naming";
import { recordStepSuccess } from "./state";

export type HostingStepResult = {
  hosting: {
    name: string;
    externalId: string | null;
    url: string | null;
    linkedAt: Date | null;
  };
  alreadyDone: boolean;
};

/**
 * Step 3 — create the hosting project bound to the repository.
 *
 * The preflight is the point of this step. Creating a project that points at a
 * repository the platform's installation cannot see produces a project that
 * never builds, and the failure surfaces far from its cause — on a screen that
 * says "no deployments" with nothing to explain why.
 */
export async function provisionHosting(params: {
  actor: Actor;
  siteProjectId: string;
}): Promise<HostingStepResult> {
  const context = await openProvisioningContext({
    actor: params.actor,
    siteProjectId: params.siteProjectId,
    provider: "vercel",
  });

  return runStep({ siteProjectId: params.siteProjectId, step: "hosting" }, async () => {
    const existing = context.project.hostingProject;
    if (existing) {
      return {
        hosting: {
          name: existing.name,
          externalId: existing.externalId,
          url: existing.url,
          linkedAt: existing.linkedAt,
        },
        alreadyDone: true,
      };
    }

    const repository = context.project.repository;
    if (!repository) {
      throw new ProviderPreflightError(
        "Crie o repositório antes de criar o projeto de hospedagem.",
      );
    }

    const provider = await hostingProviderFor(context);
    const repo = {
      owner: repository.owner,
      name: repository.name,
      externalId: repository.externalId,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
    };

    const visible = await provider.canAccessRepository({ repo });
    if (!visible) {
      throw new ProviderPreflightError(
        `A instalação da Vercel ainda não enxerga ${repo.owner}/${repo.name}. Autorize o repositório na instalação do GitHub da Vercel e tente de novo.`,
      );
    }

    const name = hostingProjectNameFor(context.project.client.slug);
    const project = await provider.createProject({ name, repo });

    // Identifiers only. A secret bound for the client's hosting project would
    // pass through memory straight to the API and never be persisted here.
    await provider.setEnvironmentVariables({
      project,
      vars: [
        { key: "NOX_SITE_PROJECT_ID", value: context.project.id, target: "preview" },
        { key: "NOX_SITE_PROJECT_ID", value: context.project.id, target: "production" },
      ],
    });

    const linkedAt = new Date();
    const stored = await prisma.hostingProject.create({
      data: {
        organizationId: context.actor.organizationId,
        siteProjectId: context.project.id,
        provider: "vercel",
        externalId: project.externalId,
        name: project.name,
        url: project.url,
        linkedAt,
      },
    });

    await recordStepSuccess({ siteProjectId: context.project.id, step: "hosting" });

    await writeAudit({
      userId: context.actor.userId,
      action: "provisioning.hosting.create",
      entity: "HostingProject",
      entityId: stored.id,
      meta: {
        mode: context.mode,
        name: project.name,
        repository: `${repo.owner}/${repo.name}`,
      },
    });

    return {
      hosting: {
        name: stored.name,
        externalId: stored.externalId,
        url: stored.url,
        linkedAt: stored.linkedAt,
      },
      alreadyDone: false,
    };
  });
}
