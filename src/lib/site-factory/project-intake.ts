import "server-only";

import { Prisma } from "@prisma/client";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

import { siteBriefSchema, type SiteBrief } from "./brief-schema";
import { createSiteBriefVersion } from "./brief-service";
import { convertBusinessToClient } from "./client-service";
import type { SiteFactoryDb } from "./db-client";
import { createSiteProject } from "./project-service";

/**
 * The three writes the wizard performs, injectable so the unit of work can be
 * exercised — including its failure paths — without reaching for test-only
 * branches in the production path.
 */
export type ProjectIntakeSteps = {
  convertBusinessToClient: typeof convertBusinessToClient;
  createSiteProject: typeof createSiteProject;
  createSiteBriefVersion: typeof createSiteBriefVersion;
};

const defaultSteps: ProjectIntakeSteps = {
  convertBusinessToClient,
  createSiteProject,
  createSiteBriefVersion,
};

export type ProjectIntakeParams = {
  actor: Actor;
  businessId: string;
  name: string;
  sector: string;
  brief: unknown;
};

/**
 * Creates the client, the project and the first brief version as one unit of
 * work.
 *
 * Validation happens before the transaction opens, so a malformed brief never
 * holds a write lock. Inside it, a failure at any step rolls the whole thing
 * back: a half-created project with no brief would sit in `RASCUNHO` with no way
 * for the operator to tell it apart from one they abandoned.
 */
export async function createProjectWithBrief(
  params: ProjectIntakeParams,
  steps: ProjectIntakeSteps = defaultSteps,
) {
  // Every permission the unit of work needs, checked up front: refusing after
  // the client row exists would mean rolling back work we never should have
  // started.
  assertPermission(params.actor, "client:write");
  assertPermission(params.actor, "project:write");
  assertPermission(params.actor, "brief:write");

  const brief: SiteBrief = siteBriefSchema.parse(params.brief);

  const runOnce = () =>
    prisma.$transaction(async (tx: SiteFactoryDb) => {
      const client = await steps.convertBusinessToClient({
        actor: params.actor,
        businessId: params.businessId,
        db: tx,
      });

      const project = await steps.createSiteProject({
        actor: params.actor,
        clientId: client.id,
        name: params.name,
        sector: params.sector,
        db: tx,
      });

      const briefVersion = await steps.createSiteBriefVersion({
        actor: params.actor,
        siteProjectId: project.id,
        brief,
        db: tx,
      });

      return {
        client,
        // The brief step moved the project on; report what the row now holds
        // rather than the snapshot taken before it.
        project: {
          ...project,
          status: "BRIEFING_PRONTO" as const,
          currentBriefVersionId: briefVersion.id,
        },
        briefVersion,
      };
    });

  try {
    return await runOnce();
  } catch (error) {
    // Two submissions for the same lead race on the unique business relation.
    // The loser rolled back cleanly, so one retry lands on the winner's client
    // and the operator gets a project instead of a conflict.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return await runOnce();
    }
    throw error;
  }
}
