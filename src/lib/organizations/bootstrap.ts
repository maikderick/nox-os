import "server-only";

import { prisma } from "@/lib/db";
import { organizationRoleFromLegacyRole } from "@/lib/authz/permissions";

export async function ensureDefaultOrganization(user: {
  id: string;
  role?: string | null;
  active?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: "nox-os" },
      update: {},
      create: { name: "NOX OS", slug: "nox-os" },
    });
    const memberCount = await tx.organizationMembership.count({
      where: { organizationId: organization.id },
    });
    return tx.organizationMembership.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: user.id },
      },
      update: { active: user.active ?? true },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: memberCount === 0 ? "OWNER" : organizationRoleFromLegacyRole(user.role),
        active: user.active ?? true,
      },
      include: { organization: true },
    });
  });
}
