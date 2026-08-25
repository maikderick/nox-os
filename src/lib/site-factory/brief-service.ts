import "server-only";

import { createHash } from "node:crypto";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { AuthorizationError } from "@/lib/authz/errors";
import { prisma } from "@/lib/db";

import { siteBriefSchema, type SiteBrief } from "./brief-schema";
import {
  canTransition,
  isSiteProjectState,
  SiteProjectTransitionError,
} from "./states";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function briefFactsHash(brief: SiteBrief): string {
  return createHash("sha256").update(JSON.stringify(stableValue(brief))).digest("hex");
}

export async function createSiteBriefVersion(params: {
  actor: Actor;
  siteProjectId: string;
  brief: unknown;
}) {
  assertPermission(params.actor, "brief:write");
  const brief = siteBriefSchema.parse(params.brief);

  return prisma.$transaction(async (tx) => {
    const project = await tx.siteProject.findFirst({
      where: { id: params.siteProjectId, organizationId: params.actor.organizationId },
      select: { id: true, status: true },
    });
    if (!project) throw AuthorizationError.missingPermission("brief:write");
    if (!isSiteProjectState(project.status)) {
      throw new Error("Estado de projeto armazenado é inválido");
    }
    if (
      project.status !== "BRIEFING_PRONTO" &&
      !canTransition(project.status, "BRIEFING_PRONTO")
    ) {
      throw new SiteProjectTransitionError(project.status, "BRIEFING_PRONTO");
    }

    const latest = await tx.siteBriefVersion.findFirst({
      where: { siteProjectId: project.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const version = await tx.siteBriefVersion.create({
      data: {
        siteProjectId: project.id,
        version: (latest?.version ?? 0) + 1,
        contentJson: JSON.stringify(brief),
        factsHash: briefFactsHash(brief),
        createdById: params.actor.userId,
      },
    });

    await tx.siteProject.update({
      where: { id: project.id },
      data: { currentBriefVersionId: version.id, status: "BRIEFING_PRONTO", statusMessage: null },
    });

    return version;
  });
}
