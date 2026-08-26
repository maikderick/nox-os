import { ProvisioningRefusal } from "./reasons";
import type { ProvisioningStep } from "./state";

/**
 * The order the four steps have to happen in, enforced where it counts.
 *
 * The screen disables what is not ready, but a screen is a suggestion: the
 * endpoints are public to anyone with a session and the permission, and each one
 * is reachable directly. So the order is checked here, before any provider is
 * touched — committing content into a repository whose branch was never
 * protected, or wiring hosting to a repository that holds no site, are mistakes
 * that only surface later and cost a real resource to undo.
 */

type RepositoryLike = {
  externalId: string | null;
  protectedAt: Date | null;
} | null;

type HostingLike = {
  externalId: string | null;
  linkedAt: Date | null;
} | null;

type ProvisioningLike = {
  contentSha256: string | null;
  commitSha: string | null;
} | null;

export type ProvisioningSnapshot = {
  repository: RepositoryLike;
  hostingProject: HostingLike;
  provisioning: ProvisioningLike;
};

/** Exists remotely *and* is protected. Either alone is an interrupted run. */
export function repositoryIsReady(repository: RepositoryLike): boolean {
  return Boolean(repository?.externalId && repository.protectedAt);
}

/** The snapshot reached the repository: both fingerprints were recorded. */
export function contentIsPublished(provisioning: ProvisioningLike): boolean {
  return Boolean(provisioning?.contentSha256 && provisioning.commitSha);
}

/** Exists remotely *and* is linked to a repository. */
export function hostingIsReady(hosting: HostingLike): boolean {
  return Boolean(hosting?.externalId && hosting.linkedAt);
}

export function assertRepositoryReady(snapshot: ProvisioningSnapshot): void {
  if (!repositoryIsReady(snapshot.repository)) {
    throw new ProvisioningRefusal("REPOSITORIO_INCOMPLETO");
  }
}

export function assertContentPublished(snapshot: ProvisioningSnapshot): void {
  if (!contentIsPublished(snapshot.provisioning)) {
    throw new ProvisioningRefusal("CONTEUDO_NAO_PUBLICADO");
  }
}

export function assertHostingReady(snapshot: ProvisioningSnapshot): void {
  if (!hostingIsReady(snapshot.hostingProject)) {
    throw new ProvisioningRefusal("HOSPEDAGEM_INCOMPLETA");
  }
}

/**
 * Which steps may run right now.
 *
 * The screen uses this to disable what is not ready. It answers the same
 * question the assertions above do, from the same fields, so the button and the
 * endpoint can never disagree about what is possible.
 */
export function runnableSteps(snapshot: ProvisioningSnapshot): Record<ProvisioningStep, boolean> {
  const repository = repositoryIsReady(snapshot.repository);
  const content = contentIsPublished(snapshot.provisioning);
  const hosting = hostingIsReady(snapshot.hostingProject);

  return {
    // Always available: it is the step that creates or finishes the repository.
    repository: true,
    content: repository,
    hosting: repository && content,
    "reconcile-preview": hosting && content,
  };
}
