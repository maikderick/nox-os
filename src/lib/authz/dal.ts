import "server-only";

import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

import { AuthorizationError } from "./errors";
import {
  isOrganizationRole,
  permissionsForRole,
  roleHasPermission,
  type OrganizationRole,
  type Permission,
} from "./permissions";

/**
 * Everything a guarded operation is allowed to know about who is calling.
 *
 * It is resolved from the session plus a live membership read, never from
 * anything the client sent, so a request cannot name its own organization or
 * role.
 */
export type Actor = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  membershipId: string;
  role: OrganizationRole;
  permissions: Permission[];
};

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
};

/**
 * Resolves the caller's membership. With no `organizationId` it settles on the
 * oldest active one, which is unambiguous while every account belongs to a
 * single organization; a multi-org UI must start passing the id explicitly.
 */
export async function resolveActiveOrganization(userId: string, organizationId?: string) {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      userId,
      active: true,
      organization: { active: true },
      ...(organizationId ? { organizationId } : {}),
    },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) return null;
  return memberships[0];
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) throw AuthorizationError.unauthenticated();
  if (session.user?.active === false) throw AuthorizationError.inactiveAccount();

  return {
    userId,
    email: session.user?.email ?? "",
    name: session.user?.name ?? "",
  };
}

export async function requireMembership(
  sessionUser: SessionUser,
  organizationId?: string,
): Promise<Actor> {
  const membership = await resolveActiveOrganization(sessionUser.userId, organizationId);
  if (!membership || !isOrganizationRole(membership.role)) {
    throw AuthorizationError.notAMember();
  }

  return {
    ...sessionUser,
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    membershipId: membership.id,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
}

export async function getActor(organizationId?: string): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId || session.user?.active === false) return null;

  const membership = await resolveActiveOrganization(userId, organizationId);
  if (!membership) return null;
  if (!isOrganizationRole(membership.role)) return null;

  return {
    userId,
    email: session?.user?.email ?? "",
    name: session?.user?.name ?? "",
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    membershipId: membership.id,
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  };
}

export async function requireActor(organizationId?: string): Promise<Actor> {
  return requireMembership(await requireSession(), organizationId);
}

export function assertPermission(actor: Actor, permission: Permission): void {
  if (!roleHasPermission(actor.role, permission)) {
    throw AuthorizationError.missingPermission(permission);
  }
}

/**
 * The guard every mutating path should use: resolve the caller and refuse in one
 * step, as close to the data as possible.
 */
export async function requirePermission(
  permission: Permission,
  organizationId?: string,
): Promise<Actor> {
  const actor = await requireActor(organizationId);
  assertPermission(actor, permission);
  return actor;
}
