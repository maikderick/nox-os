import "server-only";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { AuthorizationError } from "@/lib/authz/errors";
import { prisma } from "@/lib/db";

import {
  findTransition,
  isSiteProjectState,
  isStagePendingOrchestrator,
  SiteProjectStageUnavailableError,
  SiteProjectTransitionError,
  type SiteProjectState,
} from "./states";

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "site"
  );
}

export async function createSiteProject(params: {
  actor: Actor;
  clientId: string;
  name: string;
  sector?: string | null;
}) {
  assertPermission(params.actor, "project:write");
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, organizationId: params.actor.organizationId },
    select: { id: true },
  });
  if (!client) throw AuthorizationError.missingPermission("project:write");

  const baseSlug = slugify(params.name);
  let slug = baseSlug;
  let suffix = 2;
  while (
    await prisma.siteProject.findUnique({
      where: { organizationId_slug: { organizationId: params.actor.organizationId, slug } },
      select: { id: true },
    })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return prisma.siteProject.create({
    data: {
      organizationId: params.actor.organizationId,
      clientId: client.id,
      name: params.name.trim(),
      slug,
      sector: params.sector?.trim() || null,
      createdById: params.actor.userId,
    },
  });
}

export async function listSiteProjects(actor: Actor) {
  assertPermission(actor, "project:read");
  return prisma.siteProject.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true, businessId: true } },
      currentBriefVersion: { select: { id: true, version: true, createdAt: true } },
      _count: { select: { revisions: true, deployments: true } },
    },
  });
}

export async function getSiteProject(actor: Actor, siteProjectId: string) {
  assertPermission(actor, "project:read");
  const project = await prisma.siteProject.findFirst({
    where: { id: siteProjectId, organizationId: actor.organizationId },
    include: {
      client: { include: { business: true } },
      briefVersions: { orderBy: { version: "desc" } },
      generationRuns: { orderBy: { createdAt: "desc" } },
      revisions: { orderBy: { version: "desc" } },
      deployments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) throw AuthorizationError.missingPermission("project:read");
  return project;
}

export async function transitionSiteProject(params: {
  actor: Actor;
  siteProjectId: string;
  to: SiteProjectState;
}) {
  const project = await prisma.siteProject.findFirst({
    where: { id: params.siteProjectId, organizationId: params.actor.organizationId },
    select: { id: true, status: true },
  });
  if (!project || !isSiteProjectState(project.status)) {
    throw AuthorizationError.missingPermission("project:read");
  }

  const transition = findTransition(project.status, params.to);
  if (!transition) throw new SiteProjectTransitionError(project.status, params.to);
  if (transition.permission === null) {
    throw new SiteProjectTransitionError(project.status, params.to);
  }
  assertPermission(params.actor, transition.permission);

  // Checked after authorization so an unauthorized caller still gets 403, and
  // before any write so a refused stage leaves the project exactly as it was.
  if (isStagePendingOrchestrator(params.to)) {
    throw new SiteProjectStageUnavailableError(params.to);
  }

  return prisma.siteProject.update({
    where: { id: project.id },
    data: { status: params.to, statusMessage: null },
  });
}
