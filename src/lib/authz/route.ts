import { NextResponse } from "next/server";

import { AuthorizationError, isAuthorizationError } from "./errors";

/**
 * Turns a thrown `AuthorizationError` into the response it describes, and lets
 * anything else keep bubbling. Route handlers stay readable: they call a guard
 * at the top and never spell out 401/403 by hand.
 */
export function authorizationResponse(error: unknown): NextResponse | null {
  if (!isAuthorizationError(error)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function withAuthorization<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const response = authorizationResponse(error);
    if (response) return response;
    throw error;
  }
}

/**
 * Wraps a route handler so every authorization refusal inside it becomes the
 * response it describes. Handlers then start with a `requirePermission` call and
 * never spell out 401/403 themselves.
 */
export function authorized<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | NextResponse> {
  return (...args: A) => withAuthorization(() => handler(...args));
}

export { AuthorizationError };
