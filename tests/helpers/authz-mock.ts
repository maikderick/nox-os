import { AuthorizationError } from "@/lib/authz/errors";
import {
  permissionsForRole,
  roleHasPermission,
  type OrganizationRole,
  type Permission,
} from "@/lib/authz/permissions";

export type RoleBox = { role: OrganizationRole };

export function actorFor(role: OrganizationRole) {
  return {
    userId: "user-1",
    email: "pessoa@noxos.local",
    name: "Pessoa",
    organizationId: "org-1",
    organizationSlug: "nox-os",
    organizationName: "NOX OS",
    membershipId: "membership-1",
    role,
    permissions: permissionsForRole(role),
  };
}

/**
 * A stand-in for the data access layer that keeps the real permission matrix.
 *
 * Routes are exercised end to end against the same table production uses, so a
 * test that says "a viewer gets 403" is proving the matrix, not a hand-written
 * mock that happens to agree with it.
 */
export function dalMock(box: RoleBox) {
  const requireSession = async () => ({
    userId: "user-1",
    email: "pessoa@noxos.local",
    name: "Pessoa",
  });

  const requireActor = async () => actorFor(box.role);

  const assertPermission = (
    actor: { role: OrganizationRole },
    permission: Permission,
  ): void => {
    if (!roleHasPermission(actor.role, permission)) {
      throw AuthorizationError.missingPermission(permission);
    }
  };

  const requirePermission = async (permission: Permission) => {
    const actor = await requireActor();
    assertPermission(actor, permission);
    return actor;
  };

  return {
    requireSession,
    requireActor,
    requireMembership: requireActor,
    getActor: requireActor,
    assertPermission,
    requirePermission,
    resolveActiveOrganization: async () => null,
  };
}
