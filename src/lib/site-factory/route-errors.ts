import { NextResponse } from "next/server";

import { authorizationResponse } from "@/lib/authz/route";

import {
  SITE_PROJECT_ERROR_CODES,
  SiteProjectStageUnavailableError,
  SiteProjectTransitionError,
} from "./states";

/**
 * Domain refusals that are neither a bad request nor a permission problem: the
 * project exists and the caller may act on it, but the move itself is not
 * possible. Both answer 409 and carry a stable `code`, so a client branches on
 * the reason instead of matching prose.
 */
export function siteProjectErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SiteProjectStageUnavailableError) {
    return NextResponse.json(
      { error: error.message, code: error.code, state: error.state },
      { status: 409 },
    );
  }

  if (error instanceof SiteProjectTransitionError) {
    return NextResponse.json(
      {
        error: error.message,
        code: SITE_PROJECT_ERROR_CODES.invalidTransition,
        from: error.from,
        to: error.to,
      },
      { status: 409 },
    );
  }

  return null;
}

/** Authorization first, then the domain refusals; anything else keeps bubbling. */
export async function withSiteFactoryErrors<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;
    const refused = siteProjectErrorResponse(error);
    if (refused) return refused;
    throw error;
  }
}
