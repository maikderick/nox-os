import "server-only";

import { Prisma } from "@prisma/client";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

import type { HostingProvider } from "@/lib/providers/ports";
import type { ProjectRef, RepoRef } from "@/lib/providers/types";
import { writeAudit } from "@/lib/settings";

import { hostingProviderFor, openProvisioningContext, runStep } from "./context";
import { hostingProjectNameFor } from "./naming";
import { ProvisioningRefusal } from "./reasons";
import { recordStepSuccess } from "./state";

export type HostingStepResult = {
  hosting: {
    name: string;
    externalId: string | null;
    url: string | null;
    linkedAt: Date | null;
  };
  alreadyDone: boolean;
  reconciled: boolean;
};

type HostingRow = {
  name: string;
  externalId: string | null;
  url: string | null;
  creationStartedAt: Date | null;
  linkedAt: Date | null;
};

/** Finished means linked: a row without `linkedAt` is an interrupted run. */
export function isHostingComplete(row: HostingRow | null): boolean {
  return Boolean(row?.externalId && row.linkedAt);
}

function toResult(row: HostingRow, flags: { alreadyDone: boolean; reconciled: boolean }) {
  return {
    hosting: {
      name: row.name,
      externalId: row.externalId,
      url: row.url,
      linkedAt: row.linkedAt,
    },
    ...flags,
  };
}

/** Whether the project found by name builds from the repository we expect. */
function linksToOurRepository(remote: ProjectRef, repo: RepoRef): boolean {
  const link = remote.linkedRepository;
  if (!link) return false;
  return (
    link.owner.toLowerCase() === repo.owner.toLowerCase() &&
    link.name.toLowerCase() === repo.name.toLowerCase()
  );
}

async function reconcileOrCreate(
  provider: HostingProvider,
  row: HostingRow,
  input: { siteProjectId: string; repo: RepoRef },
): Promise<{ ref: ProjectRef; created: boolean }> {
  const remote = await provider.getProject({ name: row.name });

  if (remote) {
    if (!row.creationStartedAt) {
      throw new ProvisioningRefusal("RECURSO_DE_TERCEIRO", { project: row.name });
    }

    // Names collide. Applying environment variables to a homonym wired to
    // somebody else's repository is a live misconfiguration on someone else's
    // site, not a recoverable local mistake.
    if (!linksToOurRepository(remote, input.repo)) {
      throw new ProvisioningRefusal("HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO", {
        project: row.name,
      });
    }

    return { ref: remote, created: false };
  }

  await prisma.hostingProject.update({
    where: { siteProjectId: input.siteProjectId },
    data: { creationStartedAt: new Date() },
  });

  const ref = await provider.createProject({ name: row.name, repo: input.repo });
  return { ref, created: true };
}

/**
 * Step 3 — create the hosting project bound to the repository.
 *
 * The preflight is the point of this step. Creating a project that points at a
 * repository the platform's installation cannot see produces a project that
 * never builds, and the failure surfaces far from its cause.
 *
 * Like step 1, the local row records the intention before the remote call, so an
 * interrupted run finishes on the next press instead of needing the project
 * deleted by hand.
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
    const existing = context.project.hostingProject as HostingRow | null;
    if (isHostingComplete(existing)) {
      return toResult(existing!, { alreadyDone: true, reconciled: false });
    }

    const repository = context.project.repository;
    if (!repository) {
      throw new ProvisioningRefusal("REPOSITORIO_INCOMPLETO");
    }

    const provider = await hostingProviderFor(context);
    const repo: RepoRef = {
      owner: repository.owner,
      name: repository.name,
      externalId: repository.externalId,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      templateRepository: null,
    };

    const visible = await provider.canAccessRepository({ repo });
    if (!visible) {
      throw new ProvisioningRefusal("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO", {
        owner: repo.owner,
        repository: repo.name,
      });
    }

    const name = existing?.name ?? hostingProjectNameFor(context.project.client.slug);

    let row = existing;
    if (!row) {
      try {
        row = await prisma.hostingProject.create({
          data: {
            organizationId: context.actor.organizationId,
            siteProjectId: context.project.id,
            provider: "vercel",
            name,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ProvisioningRefusal("NOME_OCUPADO_POR_OUTRO_PROJETO", { project: name });
        }
        throw error;
      }
    }

    const startedBefore = Boolean(row.creationStartedAt);
    const { ref, created } = await reconcileOrCreate(provider, row, {
      siteProjectId: context.project.id,
      repo,
    });

    // Identifiers only, and idempotent on the provider side, so it runs on every
    // pass — including one that only adopted an existing project.
    await provider.setEnvironmentVariables({
      project: ref,
      vars: [
        { key: "NOX_SITE_PROJECT_ID", value: context.project.id, target: "preview" },
        { key: "NOX_SITE_PROJECT_ID", value: context.project.id, target: "production" },
      ],
    });

    const stored = await prisma.hostingProject.update({
      where: { siteProjectId: context.project.id },
      data: { externalId: ref.externalId, url: ref.url, linkedAt: new Date() },
    });

    await recordStepSuccess({ siteProjectId: context.project.id, step: "hosting" });

    await writeAudit({
      userId: context.actor.userId,
      action: created
        ? "provisioning.hosting.create"
        : "provisioning.hosting.reconcile",
      entity: "HostingProject",
      entityId: stored.id,
      meta: {
        mode: context.mode,
        name: ref.name,
        repository: `${repo.owner}/${repo.name}`,
      },
    });

    return toResult(stored as HostingRow, {
      alreadyDone: false,
      reconciled: !created && startedBefore,
    });
  });
}
