/**
 * The permission matrix of the site factory.
 *
 * Roles never carry behaviour — they expand to a fixed set of permissions, and
 * every guard asks for a permission, never for a role. That way a new role is a
 * new row here instead of a new `if` scattered through the routes.
 */

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "OPERADOR", "LEITOR"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  OWNER: "Dono",
  ADMIN: "Administrador",
  OPERADOR: "Operador",
  LEITOR: "Leitor",
};

export const PERMISSIONS = [
  // Organização
  "org:read",
  "org:manage_settings",
  "org:manage_members",
  // Clientes
  "client:read",
  "client:write",
  "client:delete",
  // Projetos de site
  "project:read",
  "project:write",
  "project:delete",
  // Briefing
  "brief:write",
  "brief:approve",
  // Geração de código
  "generation:run",
  "revision:read",
  // Publicação
  "publish:request",
  "publish:approve",
  // Infraestrutura do site
  "domain:manage",
  "asset:write",
  "asset:delete",
  // Prospecção (domínio legado, mantido)
  "lead:read",
  "lead:write",
  "lead:delete",
  // Integrações externas
  "integration:manage",
  // Provisionamento
  "provisioning:read",
  "provisioning:run",
  // Fila durável
  "job:read",
  "job:run",
  // Plataforma
  "settings:write",
  "usage:read",
  "audit:read",
  "data:purge",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Everything a viewer may do: read, and nothing else. */
const LEITOR: Permission[] = [
  "org:read",
  "client:read",
  "project:read",
  "revision:read",
  "lead:read",
];

/**
 * The operator runs the factory day to day but cannot change how it is
 * configured, cannot destroy anything, and cannot approve its own work.
 * Publishing is a request, never an act.
 */
const OPERADOR: Permission[] = [
  ...LEITOR,
  "provisioning:read",
  "job:read",
  "client:write",
  "project:write",
  "brief:write",
  "generation:run",
  "publish:request",
  "asset:write",
  "lead:write",
];

const ADMIN: Permission[] = [
  ...OPERADOR,
  "org:manage_settings",
  "org:manage_members",
  "integration:manage",
  "provisioning:run",
  "job:run",
  "client:delete",
  "project:delete",
  "brief:approve",
  "publish:approve",
  "domain:manage",
  "asset:delete",
  "lead:delete",
  "settings:write",
  "usage:read",
  "audit:read",
  "data:purge",
];

const OWNER: Permission[] = [...ADMIN];

const MATRIX: Record<OrganizationRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  OPERADOR: new Set(OPERADOR),
  LEITOR: new Set(LEITOR),
};

export function permissionsForRole(role: OrganizationRole): Permission[] {
  return [...MATRIX[role]].sort();
}

export function roleHasPermission(role: OrganizationRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

/**
 * Legacy `User.role` values predate organizations. Existing accounts keep
 * working by mapping onto an organization role; the mapping is deliberately
 * conservative, so an unrecognised value lands on the least privileged role
 * instead of inheriting the old `admin` default.
 */
export function organizationRoleFromLegacyRole(legacyRole: string | null | undefined): OrganizationRole {
  if (legacyRole === "admin") return "ADMIN";
  if (legacyRole === "operator") return "OPERADOR";
  return "LEITOR";
}

/**
 * Only an owner may act on another owner. Everything else is decided by the
 * permission matrix, so this is the single place that encodes rank.
 */
export function canManageMemberWithRole(params: {
  actorRole: OrganizationRole;
  targetRole: OrganizationRole;
}): boolean {
  if (!roleHasPermission(params.actorRole, "org:manage_members")) return false;
  if (params.targetRole === "OWNER") return params.actorRole === "OWNER";
  return true;
}
