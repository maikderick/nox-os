import "server-only";

import { Prisma } from "@prisma/client";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { AuthorizationError } from "@/lib/authz/errors";
import { prisma } from "@/lib/db";

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "cliente"
  );
}

/** Converts a prospect into a client once, without copying private lead data. */
export async function convertBusinessToClient(params: { actor: Actor; businessId: string }) {
  assertPermission(params.actor, "client:write");

  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { id: true, name: true },
  });
  if (!business) throw new Error("Lead não encontrado");

  const existing = await prisma.client.findUnique({ where: { businessId: business.id } });
  if (existing) {
    if (existing.organizationId !== params.actor.organizationId) {
      throw AuthorizationError.missingPermission("client:read");
    }
    return existing;
  }

  const baseSlug = slugify(business.name);
  const collision = await prisma.client.findUnique({
    where: {
      organizationId_slug: {
        organizationId: params.actor.organizationId,
        slug: baseSlug,
      },
    },
    select: { id: true },
  });

  try {
    return await prisma.client.create({
      data: {
        organizationId: params.actor.organizationId,
        businessId: business.id,
        name: business.name,
        slug: collision ? `${baseSlug}-${business.id.slice(-6).toLowerCase()}` : baseSlug,
      },
    });
  } catch (error) {
    // Two wizard submissions can race. The unique business relation is the
    // source of truth, so the loser returns the row the winner just created.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const created = await prisma.client.findUnique({ where: { businessId: business.id } });
      if (created?.organizationId === params.actor.organizationId) return created;
    }
    throw error;
  }
}
