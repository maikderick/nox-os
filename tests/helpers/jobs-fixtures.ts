import { randomUUID } from "node:crypto";

import { describe } from "vitest";

import { prisma } from "@/lib/db";

/**
 * The queue's rules live in PostgreSQL — partial unique indexes, `FOR UPDATE
 * SKIP LOCKED`, transactional visibility. Asserting them against a mock would
 * be asserting a belief about PostgreSQL, so these suites only run when
 * `DATABASE_URL` points at the local instance, and never anywhere else.
 */
export function pointsToLocalPostgres(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const hostname = new URL(databaseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export const describeLocalDatabase = pointsToLocalPostgres(process.env.DATABASE_URL)
  ? describe
  : describe.skip;

export type QueueFixture = {
  token: string;
  organizationId: string;
  otherOrganizationId: string;
  siteProjectId: string;
  otherSiteProjectId: string;
  generationRunId: string;
  otherGenerationRunId: string;
  /** A second project of the SAME organization. Same tenant, wrong project. */
  siblingSiteProjectId: string;
};

async function createProject(
  organizationId: string,
  clientId: string,
  token: string,
  suffix: string,
) {
  const project = await prisma.siteProject.create({
    data: {
      organizationId,
      clientId,
      name: `Site ${suffix}`,
      slug: `site-${suffix}-${token}`,
      status: "BRIEFING_PRONTO",
    },
  });
  // Every project gets a brief version, because `GenerationRun.briefVersionId`
  // is a required restrict-on-delete relation and a suite that wants a second
  // run should not have to know that.
  await prisma.siteBriefVersion.create({
    data: {
      siteProjectId: project.id,
      version: 1,
      contentJson: JSON.stringify({ versao: 2 }),
      factsHash: "nao-usado-por-este-teste",
    },
  });
  return project;
}

async function createOrganizationWithProject(token: string, suffix: string) {
  const organization = await prisma.organization.create({
    data: { name: `Fila ${suffix} ${token}`, slug: `fila-${suffix}-${token}` },
  });
  const client = await prisma.client.create({
    data: {
      organizationId: organization.id,
      name: `Cliente ${suffix}`,
      slug: `cliente-${suffix}-${token}`,
    },
  });
  const siteProject = await createProject(organization.id, client.id, token, suffix);
  // Same organization, different project. Nothing but a relationship check
  // separates a job that names this one from a job that names the other.
  const sibling = await createProject(organization.id, client.id, token, `${suffix}-irmao`);
  const briefVersion = await prisma.siteBriefVersion.findFirstOrThrow({
    where: { siteProjectId: siteProject.id },
  });
  const generationRun = await prisma.generationRun.create({
    data: {
      siteProjectId: siteProject.id,
      briefVersionId: briefVersion.id,
      provider: "manual",
      requestJson: JSON.stringify({ origem: "teste" }),
    },
  });

  return {
    organizationId: organization.id,
    siteProjectId: siteProject.id,
    siblingSiteProjectId: sibling.id,
    generationRunId: generationRun.id,
  };
}

/**
 * Two organizations, each with a project and a generation run.
 *
 * The second one exists so every suite can ask the question that the foreign
 * keys cannot answer: not "does this project exist?" but "is it ours?".
 */
export async function createQueueFixture(): Promise<QueueFixture> {
  const token = randomUUID().slice(0, 8);
  const [a, b] = await Promise.all([
    createOrganizationWithProject(token, "a"),
    createOrganizationWithProject(token, "b"),
  ]);

  return {
    token,
    organizationId: a.organizationId,
    siteProjectId: a.siteProjectId,
    generationRunId: a.generationRunId,
    otherOrganizationId: b.organizationId,
    siblingSiteProjectId: a.siblingSiteProjectId,
    otherSiteProjectId: b.siteProjectId,
    otherGenerationRunId: b.generationRunId,
  };
}

export async function dropQueueFixture(fixture: QueueFixture): Promise<void> {
  // Cascades from Organization reach Job, SiteProject, GenerationRun and the
  // brief versions, so the token is only needed to find the two roots.
  await prisma.organization.deleteMany({ where: { slug: { contains: fixture.token } } });
}
