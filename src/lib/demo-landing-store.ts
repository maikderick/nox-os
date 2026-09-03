import { Prisma, type DemoLanding } from "@prisma/client";
import { prisma } from "./db";
import { applyStockPhotos, fetchDemoStockPhotos } from "./demo-landing-photos";
import type { DemoLandingContent } from "./demo-landing-schema";
import {
  createDemoSlug,
  demoExpiryDate,
  ensureDemoBusinessSnapshot,
  generateDemoLandingContent,
  isDemoLandingExpired,
  type DemoLeadInput,
} from "./demo-landing";

export type DemoBusiness = DemoLeadInput & {
  id: string;
};

/** Creates or regenerates the one active demo record associated with a lead. */
export async function regenerateDemoLanding(params: {
  business: DemoBusiness;
  createdById?: string | null;
  expiresInDays: number;
}): Promise<DemoLanding> {
  // Photos are a separate, failure-tolerant step: the generator itself stays
  // pure and offline so a provider outage can never block a demo.
  const photos = await fetchDemoStockPhotos(params.business.category);
  const content = applyStockPhotos(generateDemoLandingContent(params.business), photos);
  const contentJson = JSON.stringify(content);
  const expiresAt = demoExpiryDate(params.expiresInDays);

  // A unique collision is extraordinarily unlikely (96 random bits), but retry
  // instead of turning it into a user-visible error.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.demoLanding.upsert({
        where: { businessId: params.business.id },
        create: {
          businessId: params.business.id,
          createdById: params.createdById ?? null,
          slug: createDemoSlug(params.business.name),
          status: "DRAFT",
          contentJson,
          expiresAt,
        },
        update: {
          createdById: params.createdById ?? null,
          slug: createDemoSlug(params.business.name),
          status: "DRAFT",
          contentJson,
          expiresAt,
          approvedAt: null,
        },
      });
    } catch (error) {
      const isUniqueCollision =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueCollision || attempt === 2) throw error;
    }
  }

  throw new Error("Não foi possível gerar um endereço exclusivo para a demonstração");
}

/**
 * Captures facts for a legacy record exactly once. The conditional update avoids
 * overwriting a concurrent content edit with an older JSON payload.
 */
export async function captureLegacyDemoBusinessSnapshot(
  landing: DemoLanding,
  business: DemoLeadInput,
): Promise<DemoLanding> {
  const ensured = ensureDemoBusinessSnapshot(landing.contentJson, business);
  if (!ensured.captured) return landing;

  await prisma.demoLanding.updateMany({
    where: { id: landing.id, contentJson: landing.contentJson },
    data: { contentJson: ensured.contentJson },
  });

  return prisma.demoLanding.findUniqueOrThrow({ where: { id: landing.id } });
}

export async function markExpiredIfNeeded(landing: DemoLanding): Promise<DemoLanding> {
  if (landing.status === "EXPIRED" || !isDemoLandingExpired(landing.expiresAt)) {
    return landing;
  }

  return prisma.demoLanding.update({
    where: { id: landing.id },
    data: { status: "EXPIRED" },
  });
}

/**
 * Stores content that was built elsewhere — from a confirmed brief, for
 * instance — as the lead's one demo record. An existing record keeps its slug,
 * so a link already sent to the client survives a regeneration.
 */
export async function saveGeneratedDemoLanding(params: {
  business: { id: string; name: string };
  content: DemoLandingContent;
  createdById?: string | null;
  expiresInDays: number;
  status: "DRAFT" | "APPROVED";
}): Promise<DemoLanding> {
  const contentJson = JSON.stringify(params.content);
  const expiresAt = demoExpiryDate(params.expiresInDays);
  const approvedAt = params.status === "APPROVED" ? new Date() : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.demoLanding.upsert({
        where: { businessId: params.business.id },
        create: {
          businessId: params.business.id,
          createdById: params.createdById ?? null,
          slug: createDemoSlug(params.business.name),
          status: params.status,
          contentJson,
          expiresAt,
          approvedAt,
        },
        update: {
          createdById: params.createdById ?? null,
          status: params.status,
          contentJson,
          expiresAt,
          approvedAt,
        },
      });
    } catch (error) {
      const isUniqueCollision =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueCollision || attempt === 2) throw error;
    }
  }

  throw new Error("Não foi possível gerar um endereço exclusivo para a demonstração");
}
