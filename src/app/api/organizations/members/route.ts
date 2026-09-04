import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { withAuthorization } from "@/lib/authz/route";
import {
  canManageMemberWithRole,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

const addMemberSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: z.enum(ORGANIZATION_ROLES),
  })
  .strict();

const updateMemberSchema = z
  .object({
    membershipId: z.string().trim().min(1).max(128),
    role: z.enum(ORGANIZATION_ROLES).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.active !== undefined, {
    message: "Informe uma alteração",
  });

export async function GET() {
  return withAuthorization(async () => {
    const actor = await requirePermission("org:read");
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, active: true } } },
    });
    return NextResponse.json({ members });
  });
}

export async function POST(request: Request) {
  return withAuthorization(async () => {
    const actor = await requirePermission("org:manage_members");
    const body = addMemberSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }
    if (!canManageMemberWithRole({ actorRole: actor.role, targetRole: body.data.role })) {
      return NextResponse.json({ error: "Somente o dono pode adicionar outro dono." }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { email: body.data.email.toLowerCase() },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

    const membership = await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: { organizationId: actor.organizationId, userId: user.id },
      },
      update: { active: true, role: body.data.role },
      create: {
        organizationId: actor.organizationId,
        userId: user.id,
        role: body.data.role,
      },
      include: { user: { select: { id: true, name: true, email: true, active: true } } },
    });
    return NextResponse.json({ membership }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withAuthorization(async () => {
    const actor = await requirePermission("org:manage_members");
    const body = updateMemberSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const target = await prisma.organizationMembership.findFirst({
      where: { id: body.data.membershipId, organizationId: actor.organizationId },
    });
    if (!target || !ORGANIZATION_ROLES.includes(target.role as OrganizationRole)) {
      return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
    }
    const targetRole = target.role as OrganizationRole;
    const nextRole = body.data.role ?? targetRole;
    if (
      !canManageMemberWithRole({ actorRole: actor.role, targetRole }) ||
      !canManageMemberWithRole({ actorRole: actor.role, targetRole: nextRole })
    ) {
      return NextResponse.json({ error: "Somente o dono pode alterar outro dono." }, { status: 403 });
    }
    if (targetRole === "OWNER" && (nextRole !== "OWNER" || body.data.active === false)) {
      const owners = await prisma.organizationMembership.count({
        where: { organizationId: actor.organizationId, role: "OWNER", active: true },
      });
      if (owners <= 1) {
        return NextResponse.json({ error: "A organização precisa manter ao menos um dono." }, { status: 409 });
      }
    }

    const membership = await prisma.organizationMembership.update({
      where: { id: target.id },
      data: { role: body.data.role, active: body.data.active },
      include: { user: { select: { id: true, name: true, email: true, active: true } } },
    });
    return NextResponse.json({ membership });
  });
}
