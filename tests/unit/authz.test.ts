import { describe, expect, it } from "vitest";

import { AuthorizationError } from "../../src/lib/authz/errors";
import {
  ORGANIZATION_ROLES,
  canManageMemberWithRole,
  organizationRoleFromLegacyRole,
  permissionsForRole,
  roleHasPermission,
} from "../../src/lib/authz/permissions";

describe("organization permission matrix", () => {
  it("gives every role read access to the new domain", () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(roleHasPermission(role, "org:read")).toBe(true);
      expect(roleHasPermission(role, "project:read")).toBe(true);
      expect(roleHasPermission(role, "client:read")).toBe(true);
    }
  });

  it("keeps destructive, approval and configuration powers away from operators", () => {
    const permissions = permissionsForRole("OPERADOR");
    expect(permissions).not.toContain("settings:write");
    expect(permissions).not.toContain("client:delete");
    expect(permissions).not.toContain("project:delete");
    expect(permissions).not.toContain("asset:delete");
    expect(permissions).not.toContain("publish:approve");
    expect(permissions).not.toContain("org:manage_members");
  });

  it("lets operators run the workflow without approving their own work", () => {
    expect(roleHasPermission("OPERADOR", "project:write")).toBe(true);
    expect(roleHasPermission("OPERADOR", "brief:write")).toBe(true);
    expect(roleHasPermission("OPERADOR", "generation:run")).toBe(true);
    expect(roleHasPermission("OPERADOR", "publish:request")).toBe(true);
    expect(roleHasPermission("OPERADOR", "brief:approve")).toBe(false);
  });

  it("maps unknown legacy roles to least privilege", () => {
    expect(organizationRoleFromLegacyRole("admin")).toBe("ADMIN");
    expect(organizationRoleFromLegacyRole("operator")).toBe("OPERADOR");
    expect(organizationRoleFromLegacyRole("unexpected")).toBe("LEITOR");
    expect(organizationRoleFromLegacyRole(undefined)).toBe("LEITOR");
  });

  it("protects owners from administration by non-owners", () => {
    expect(canManageMemberWithRole({ actorRole: "ADMIN", targetRole: "OWNER" })).toBe(false);
    expect(canManageMemberWithRole({ actorRole: "OWNER", targetRole: "OWNER" })).toBe(true);
    expect(canManageMemberWithRole({ actorRole: "ADMIN", targetRole: "OPERADOR" })).toBe(true);
  });
});

describe("authorization errors", () => {
  it("distinguishes authentication and permission failures", () => {
    expect(AuthorizationError.unauthenticated()).toMatchObject({ status: 401 });
    expect(AuthorizationError.missingPermission("project:write")).toMatchObject({
      status: 403,
      permission: "project:write",
    });
  });
});
