import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/dal";
import { withAuthorization } from "@/lib/authz/route";
import { prisma } from "@/lib/db";

export async function GET() {
  return withAuthorization(async () => {
    const actor = await requirePermission("org:read");
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      include: {
        memberships: {
          where: { active: true },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, email: true, active: true } } },
        },
      },
    });
    return NextResponse.json({ organization, actor });
  });
}
