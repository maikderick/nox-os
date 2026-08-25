import type { Permission } from "./permissions";

/**
 * Authorization failures carry the HTTP status with them so a route handler
 * never has to guess whether a refusal was "not signed in" or "not allowed".
 */
export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly permission?: Permission;

  constructor(message: string, status: 401 | 403, permission?: Permission) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
    this.permission = permission;
  }

  static unauthenticated(): AuthorizationError {
    return new AuthorizationError("Faça login para continuar.", 401);
  }

  static inactiveAccount(): AuthorizationError {
    return new AuthorizationError("Sua conta está inativa.", 403);
  }

  static notAMember(): AuthorizationError {
    return new AuthorizationError("Você não participa desta organização.", 403);
  }

  static missingPermission(permission: Permission): AuthorizationError {
    return new AuthorizationError(
      "Você não tem autorização para esta ação.",
      403,
      permission,
    );
  }
}

export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
