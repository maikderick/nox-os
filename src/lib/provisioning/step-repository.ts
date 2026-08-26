import "server-only";

import { Prisma } from "@prisma/client";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

import type { GitRepositoryProvider } from "@/lib/providers/ports";
import type { RepoRef } from "@/lib/providers/types";
import { writeAudit } from "@/lib/settings";

import {
  gitProviderFor,
  openProvisioningContext,
  resolveSitesOwner,
  runStep,
  type ProvisioningContext,
} from "./context";
import { REQUIRED_CHECK, SITE_TEMPLATE, repositoryNameFor } from "./naming";
import { ProvisioningRefusal } from "./reasons";
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
  /** True when this call found the work already finished. */
  alreadyDone: boolean;
  /** True when this call finished work a previous, interrupted run had started. */
  reconciled: boolean;
};

type RepositoryRow = {
  owner: string;
  name: string;
  url: string | null;
  externalId: string | null;
  defaultBranch: string;
  creationStartedAt: Date | null;
  protectedAt: Date | null;
};

/**
 * A repository is finished only when both halves landed: it exists remotely
 * (`externalId`) and its default branch is protected (`protectedAt`). A row with
 * either missing is a run that was interrupted, not a result.
 */
export function isRepositoryComplete(row: RepositoryRow | null): boolean {
  return Boolean(row?.externalId && row.protectedAt);
}

function toResult(row: RepositoryRow, flags: { alreadyDone: boolean; reconciled: boolean }) {
  return {
    repository: {
      owner: row.owner,
      name: row.name,
      url: row.url,
      externalId: row.externalId,
      defaultBranch: row.defaultBranch,
      protectedAt: row.protectedAt,
    },
    ...flags,
  };
}

/**
 * Writes down what is about to be attempted, before attempting it.
 *
 * The unique index on (provider, owner, name) is what makes this safe: if the
 * name belongs to another project, this fails here — locally, cheaply, before
 * anything remote happens.
 */
async function recordIntent(
  context: ProvisioningContext,
  input: { owner: string; name: string },
) {
  try {
    return await prisma.repository.create({
      data: {
        organizationId: context.actor.organizationId,
        siteProjectId: context.project.id,
        provider: "github",
        owner: input.owner,
        name: input.name,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProvisioningRefusal("NOME_OCUPADO_POR_OUTRO_PROJETO", {
        owner: input.owner,
        repository: input.name,
      });
    }
    throw error;
  }
}

/**
 * Brings a started-but-unfinished repository to completion.
 *
 * Whether the previous run died before or after the remote call, the answer is
 * the same: ask the host what is there, adopt it if it exists, create it if it
 * does not, then protect. Nothing has to be renamed or deleted by hand.
 */
/**
 * Whether a repository found by name is one this factory generated.
 *
 * `creationStartedAt` only proves that *an attempt happened* — it says nothing
 * about the thing standing there now. A third party can take the name between
 * the lookup and the create, and a create can answer conflict for a repository
 * that was never ours. So the evidence has to come from the host: a repository
 * generated from our template says so.
 */
function wasGeneratedByUs(remote: RepoRef): boolean {
  const template = remote.templateRepository;
  if (!template) return false;
  return (
    template.owner.toLowerCase() === SITE_TEMPLATE.owner.toLowerCase() &&
    template.name.toLowerCase() === SITE_TEMPLATE.repo.toLowerCase()
  );
}

async function reconcileOrCreate(
  provider: GitRepositoryProvider,
  row: RepositoryRow,
  siteProjectId: string,
): Promise<{ ref: RepoRef; created: boolean }> {
  const remote = await provider.getRepository({ owner: row.owner, name: row.name });

  if (remote) {
    if (!row.creationStartedAt) {
      // The name was taken before we ever tried. Adopting it would mean
      // committing a client's site into somebody else's repository.
      throw new ProvisioningRefusal("RECURSO_DE_TERCEIRO", {
        owner: row.owner,
        repository: row.name,
      });
    }

    if (!wasGeneratedByUs(remote)) {
      // An attempt happened and something is there, but nothing proves the two
      // are the same event. This stops for a person rather than guessing: the
      // cost of guessing wrong is a client's site committed into a stranger's
      // repository.
      throw new ProvisioningRefusal("PROVENIENCIA_NAO_COMPROVADA", {
        owner: row.owner,
        repository: row.name,
      });
    }

    return { ref: remote, created: false };
  }

  // Marked before the remote call, so a crash in the window between them is
  // distinguishable from never having tried.
  await prisma.repository.update({
    where: { siteProjectId },
    data: { creationStartedAt: new Date() },
  });

  const ref = await provider.createFromTemplate({
    owner: row.owner,
    name: row.name,
    templateOwner: SITE_TEMPLATE.owner,
    templateRepo: SITE_TEMPLATE.repo,
  });
  return { ref, created: true };
}

/**
 * Step 1 — create the client's repository from the template and protect it.
 *
 * Safe to repeat at any point: the local row records the intention before the
 * remote call, so a crash in the window between them leaves enough behind to
 * finish the job on the next press.
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
    const existing = context.project.repository as RepositoryRow | null;
    if (isRepositoryComplete(existing)) {
      return toResult(existing!, { alreadyDone: true, reconciled: false });
    }

    const provider = await gitProviderFor(context);
    const owner = existing?.owner ?? (await resolveSitesOwner(context));
    const name = existing?.name ?? repositoryNameFor(context.project.client.slug);

    // Intent first. Everything after this point can be repeated.
    const row = existing ?? (await recordIntent(context, { owner, name }));
    const startedBefore = Boolean(row.creationStartedAt);

    const { ref, created } = await reconcileOrCreate(
      provider,
      row as RepositoryRow,
      context.project.id,
    );

    // Protection is idempotent on the provider side, so it is applied on every
    // pass — including one that only adopted an already-created repository.
    await provider.protectDefaultBranch({ repo: ref, requiredChecks: [REQUIRED_CHECK] });

    const stored = await prisma.repository.update({
      where: { siteProjectId: context.project.id },
      data: {
        externalId: ref.externalId,
        url: ref.url,
        defaultBranch: ref.defaultBranch,
        protectedAt: new Date(),
      },
    });

    await recordStepSuccess({ siteProjectId: context.project.id, step: "repository" });

    // Two events, not one: creating a repository and applying a ruleset are
    // different acts with different consequences, and a review of an incident
    // has to be able to see that the second one happened even when the first
    // was a no-op.
    if (created) {
      await writeAudit({
        userId: context.actor.userId,
        action: "provisioning.repository.create",
        entity: "Repository",
        entityId: stored.id,
        meta: { mode: context.mode, owner: ref.owner, name: ref.name },
      });
    } else if (startedBefore) {
      await writeAudit({
        userId: context.actor.userId,
        action: "provisioning.repository.reconcile",
        entity: "Repository",
        entityId: stored.id,
        meta: { mode: context.mode, owner: ref.owner, name: ref.name },
      });
    }

    await writeAudit({
      userId: context.actor.userId,
      action: "provisioning.repository.protect",
      entity: "Repository",
      entityId: stored.id,
      meta: {
        mode: context.mode,
        owner: ref.owner,
        name: ref.name,
        requiredChecks: [REQUIRED_CHECK],
      },
    });

    return toResult(stored as RepositoryRow, {
      alreadyDone: false,
      reconciled: !created && startedBefore,
    });
  });
}
