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

export { AuthorizationError };
