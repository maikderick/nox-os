import { Prisma, type DemoLanding } from "@prisma/client";
import { prisma } from "./db";
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
  const contentJson = JSON.stringify(generateDemoLandingContent(params.business));
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
