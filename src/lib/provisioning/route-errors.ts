import { NextResponse } from "next/server";

import { authorizationResponse } from "@/lib/authz/route";
import {
  IntegrationDisabledError,
  IntegrationModeUnsupportedError,
  ProviderPreflightError,
  ProviderResourceConflictError,
  ProviderResourceNotFoundError,
  redactProviderError,
} from "@/lib/providers/errors";

import { ProvisioningNotEligibleError } from "./eligibility";

/**
 * Turns a provider refusal into the response it describes.
 *
 * Every one carries a stable code, and every message passes through redaction on
 * the way out: an error from a provider frequently quotes the request that
 * caused it, and that request carried an authorization header.
 */
export function provisioningErrorResponse(error: unknown): NextResponse | null {
  const answer = (status: number, code: string, message: string) =>
    NextResponse.json({ error: redactProviderError(message), code }, { status });

  if (error instanceof ProvisioningNotEligibleError) {
    // The request is well formed and the caller is allowed; the project simply
    // is not in a state where provisioning means anything.
    return answer(409, error.code, error.message);
  }
  if (error instanceof IntegrationDisabledError) {
    return answer(409, error.code, error.message);
  }
  if (error instanceof IntegrationModeUnsupportedError) {
    return answer(409, error.code, error.message);
  }
  if (error instanceof ProviderPreflightError) {
    return answer(409, error.code, error.message);
  }
  if (error instanceof ProviderResourceConflictError) {
    return answer(409, error.code, error.message);
  }
  if (error instanceof ProviderResourceNotFoundError) {
    return answer(404, error.code, error.message);
  }
  return null;
}

export async function withProvisioningErrors<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;
    const refused = provisioningErrorResponse(error);
    if (refused) return refused;
    throw error;
  }
}
