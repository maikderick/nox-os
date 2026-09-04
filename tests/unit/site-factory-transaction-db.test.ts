import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { createSiteBriefVersion } from "@/lib/site-factory/brief-service";
import { convertBusinessToClient } from "@/lib/site-factory/client-service";
import { createProjectWithBrief } from "@/lib/site-factory/project-intake";
import {
  createSiteProject,
  getSiteProject,
  listSiteProjects,
  transitionSiteProject,
} from "@/lib/site-factory/project-service";

function pointsToLocalPostgres(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const hostname = new URL(databaseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

const describeLocalDatabase = pointsToLocalPostgres(process.env.DATABASE_URL)
  ? describe
  : describe.skip;

const confirmedAt = "2026-08-25T12:00:00.000Z";
const fact = (value: string) => ({ value, source: "OPERADOR" as const, confirmedAt });

function brief(businessName: string) {
  return {
    schemaVersion: 1 as const,
    businessName: fact(businessName),
    sector: fact("Padaria"),
    objective: fact("Apresentar o negócio."),
    audience: fact("Pessoas da região."),
    positioning: fact("Informações claras sobre o negócio."),
    desiredSections: ["Início", "Contato"],
    visualDirection: fact("Visual contemporâneo e legível."),
  };
}

describeLocalDatabase("site factory unit of work", () => {
  const token = randomUUID();
  const source = "factory-transaction-test";

  let actorA: Actor;
  let actorB: Actor;
  let businessA: string;
  let businessB: string;

  async function buildTenant(suffix: string) {
    const user = await prisma.user.create({
      data: {
        email: `factory-tx-${suffix}-${token}@example.test`,
        name: `Teste ${suffix}`,
        passwordHash: "not-used-by-this-test",
        role: "operator",
      },
    });
    const organization = await prisma.organization.create({
      data: { name: `Organização ${suffix}`, slug: `factory-tx-${suffix}-${token}` },
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    const business = await prisma.business.create({
      data: {
        source,
        externalId: `factory-tx-${suffix}-${token}`,
        name: `Padaria ${suffix}`,
        nameNormalized: `padaria ${suffix}`,
        category: "Padaria",
      },
    });

    const actor: Actor = {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      membershipId: membership.id,
      role: "OWNER",
      permissions: permissionsForRole("OWNER"),
    };

    return { actor, businessId: business.id };
  }

  beforeAll(async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");
    actorA = a.actor;
    actorB = b.actor;
    businessA = a.businessId;
    businessB = b.businessId;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { contains: token } } });
    await prisma.business.deleteMany({ where: { source, externalId: { contains: token } } });
    await prisma.user.deleteMany({ where: { email: { contains: token } } });
  });

  describe("atomic creation", () => {
    it("rolls the whole submission back when the brief fails", async () => {
      const failure = new Error("falha proposital no briefing");

      await expect(
        createProjectWithBrief(
          {
            actor: actorA,
            businessId: businessA,
            name: "Site que não deve sobreviver",
            sector: "Padaria",
            brief: brief("Padaria a"),
          },
          {
            convertBusinessToClient,
            createSiteProject,
            createSiteBriefVersion: async () => {
              throw failure;
            },
          },
        ),
      ).rejects.toThrow(failure);

      // Neither the client created in step one nor the project from step two
      // may outlive the failed brief.
      expect(await prisma.client.findUnique({ where: { businessId: businessA } })).toBeNull();
      expect(
        await prisma.siteProject.count({
          where: { organizationId: actorA.organizationId },
        }),
      ).toBe(0);
      expect(
        await prisma.siteBriefVersion.count({
          where: { siteProject: { organizationId: actorA.organizationId } },
        }),
      ).toBe(0);
    });

    it("commits client, project and first brief together", async () => {
      const result = await createProjectWithBrief({
        actor: actorA,
        businessId: businessA,
        name: "Site Padaria A",
        sector: "Padaria",
        brief: brief("Padaria a"),
      });

      expect(result.client.businessId).toBe(businessA);
      expect(result.briefVersion.version).toBe(1);

      const stored = await prisma.siteProject.findUniqueOrThrow({
        where: { id: result.project.id },
      });
      expect(stored.status).toBe("BRIEFING_PRONTO");
      expect(stored.currentBriefVersionId).toBe(result.briefVersion.id);
    });

    it("keeps the conversion idempotent across submissions", async () => {
      const second = await createProjectWithBrief({
        actor: actorA,
        businessId: businessA,
        name: "Site Padaria A",
        sector: "Padaria",
        brief: brief("Padaria a"),
      });

      const clients = await prisma.client.findMany({
        where: { organizationId: actorA.organizationId },
      });

      // One client for the lead, however many projects it ends up with.
      expect(clients).toHaveLength(1);
      expect(second.client.id).toBe(clients[0].id);
      expect(second.project.slug).not.toBe("site-padaria-a");
    });
  });

  describe("isolation between organizations", () => {
    let projectOfB: string;

    beforeAll(async () => {
      const created = await createProjectWithBrief({
        actor: actorB,
        businessId: businessB,
        name: "Site Padaria B",
        sector: "Padaria",
        brief: brief("Padaria b"),
      });
      projectOfB = created.project.id;
    });

    it("does not list another organization's projects", async () => {
      const visible = await listSiteProjects(actorA);
      expect(visible.map((project) => project.id)).not.toContain(projectOfB);

      const owned = await listSiteProjects(actorB);
      expect(owned.map((project) => project.id)).toContain(projectOfB);
    });

    it("does not read another organization's project", async () => {
      await expect(getSiteProject(actorA, projectOfB)).rejects.toMatchObject({ status: 403 });
      await expect(getSiteProject(actorB, projectOfB)).resolves.toMatchObject({ id: projectOfB });
    });

    it("does not transition another organization's project", async () => {
      await expect(
        transitionSiteProject({ actor: actorA, siteProjectId: projectOfB, to: "RASCUNHO" }),
      ).rejects.toMatchObject({ status: 403 });

      const untouched = await prisma.siteProject.findUniqueOrThrow({ where: { id: projectOfB } });
      expect(untouched.status).toBe("BRIEFING_PRONTO");
    });

    it("does not add a brief version to another organization's project", async () => {
      await expect(
        createSiteBriefVersion({
          actor: actorA,
          siteProjectId: projectOfB,
          brief: brief("Padaria b"),
        }),
      ).rejects.toMatchObject({ status: 403 });

      const versions = await prisma.siteBriefVersion.count({
        where: { siteProjectId: projectOfB },
      });
      expect(versions).toBe(1);
    });

    it("refuses to hand another organization's lead over as a client", async () => {
      await expect(
        convertBusinessToClient({ actor: actorA, businessId: businessB }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
