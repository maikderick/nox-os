import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { createSiteBriefVersion } from "@/lib/site-factory/brief-service";
import { convertBusinessToClient } from "@/lib/site-factory/client-service";
import { createSiteProject } from "@/lib/site-factory/project-service";

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

describeLocalDatabase("site factory database integration", () => {
  const token = randomUUID();
  const organizationSlug = `factory-test-${token}`;
  const userEmail = `factory-test-${token}@example.test`;
  const businessExternalId = `factory-test-${token}`;

  let actor: Actor;
  let businessId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        name: "Teste Fábrica",
        passwordHash: "not-used-by-this-test",
        role: "operator",
      },
    });
    const organization = await prisma.organization.create({
      data: { name: "Organização de teste", slug: organizationSlug },
    });
    const membership = await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "OWNER",
      },
    });
    const business = await prisma.business.create({
      data: {
        source: "factory-integration-test",
        externalId: businessExternalId,
        name: "Padaria Aurora",
        nameNormalized: "padaria aurora",
        category: "Padaria",
        address: "Rua que não deve ser copiada, 123",
        phoneRaw: "+55 85 99999-0000",
        socialLinks: JSON.stringify(["https://example.test/padaria-aurora"]),
      },
    });

    businessId = business.id;
    actor = {
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
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: organizationSlug } });
    await prisma.business.deleteMany({
      where: { source: "factory-integration-test", externalId: businessExternalId },
    });
    await prisma.user.deleteMany({ where: { email: userEmail } });
  });

  it("persists an idempotent client, project and immutable brief versions", async () => {
    const firstClient = await convertBusinessToClient({ actor, businessId });
    const secondClient = await convertBusinessToClient({ actor, businessId });

    expect(secondClient.id).toBe(firstClient.id);
    expect(firstClient).toMatchObject({
      organizationId: actor.organizationId,
      businessId,
      name: "Padaria Aurora",
      contactName: null,
      contactEmail: null,
      contactPhoneE164: null,
    });

    const project = await createSiteProject({
      actor,
      clientId: firstClient.id,
      name: "Site Padaria Aurora",
      sector: "Padaria",
    });
    expect(project.status).toBe("RASCUNHO");

    const confirmedAt = "2026-08-25T12:00:00.000Z";
    const fact = (value: string) => ({ value, source: "OPERADOR" as const, confirmedAt });
    const firstBrief = await createSiteBriefVersion({
      actor,
      siteProjectId: project.id,
      brief: {
        schemaVersion: 1,
        businessName: fact("Padaria Aurora"),
        sector: fact("Padaria"),
        city: null,
        objective: fact("Apresentar informações confirmadas sobre o negócio."),
        audience: fact("Pessoas que procuram uma padaria na região."),
        positioning: fact("Comunicação clara sobre o negócio."),
        services: [],
        differentiators: [],
        desiredSections: ["Início", "Sobre", "Contato"],
        visualDirection: fact("Layout sóbrio e legível."),
        notes: null,
      },
    });
    const secondBrief = await createSiteBriefVersion({
      actor,
      siteProjectId: project.id,
      brief: {
        schemaVersion: 1,
        businessName: fact("Padaria Aurora"),
        sector: fact("Padaria"),
        city: null,
        objective: fact("Apresentar informações confirmadas sobre o negócio."),
        audience: fact("Pessoas que procuram uma padaria na região."),
        positioning: fact("Comunicação clara sobre o negócio."),
        services: [],
        differentiators: [],
        desiredSections: ["Início", "Sobre", "Produtos", "Contato"],
        visualDirection: fact("Layout sóbrio e legível."),
        notes: null,
      },
    });

    expect([firstBrief.version, secondBrief.version]).toEqual([1, 2]);
    expect(secondBrief.id).not.toBe(firstBrief.id);

    const storedProject = await prisma.siteProject.findUniqueOrThrow({
      where: { id: project.id },
      include: { briefVersions: { orderBy: { version: "asc" } } },
    });
    expect(storedProject.status).toBe("BRIEFING_PRONTO");
    expect(storedProject.currentBriefVersionId).toBe(secondBrief.id);
    expect(storedProject.briefVersions).toHaveLength(2);
    expect(storedProject.briefVersions[0]?.contentJson).toContain('"Sobre"');
    expect(storedProject.briefVersions[0]?.contentJson).not.toContain('"Produtos"');
  });
});
