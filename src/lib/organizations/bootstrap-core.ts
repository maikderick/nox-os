import type { Prisma } from "@prisma/client";

import { organizationRoleFromLegacyRole } from "../authz/permissions";

/**
 * Any Prisma client will do — the pooled one, a transaction client, or the
 * standalone client the seed script builds. This module stays free of
 * `server-only` precisely so the seed can reach it.
 */
type BootstrapDb = Prisma.TransactionClient;

/**
 * Makes sure an account can actually use the factory.
 *
 * A fresh install runs the migrations before the seed, so the backfill finds no
 * users and the seeded administrator would end up with no membership — refused
 * by every guarded route. This closes that gap and is safe to call again.
 *
 * It never writes on update. Re-activating a membership an administrator
 * switched off would silently hand access back, which is the one thing a
 * bootstrap helper must not do.
 */
export async function ensureDefaultOrganizationOn(
  db: BootstrapDb,
  user: { id: string; role?: string | null; active?: boolean },
) {
  const organization = await db.organization.upsert({
    where: { slug: "nox-os" },
    update: {},
    create: { name: "NOX OS", slug: "nox-os" },
  });

  const existing = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId: organization.id, userId: user.id },
    },
    include: { organization: true },
  });
  if (existing) return existing;

  const memberCount = await db.organizationMembership.count({
    where: { organizationId: organization.id },
  });

  return db.organizationMembership.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      // Whoever bootstraps an empty organization owns it; everyone else keeps
      // the closest equivalent of their legacy role.
      role: memberCount === 0 ? "OWNER" : organizationRoleFromLegacyRole(user.role),
      active: user.active ?? true,
    },
    include: { organization: true },
  });
}
