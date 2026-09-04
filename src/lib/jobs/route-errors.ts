import { NextResponse } from "next/server";

import { authorizationResponse } from "@/lib/authz/route";
import { isCreditRefusal } from "@/lib/credits/reasons";

import { ConciliationRefusal } from "./conciliation";
import { describeJobError } from "./error-record";
import { isJobRefusal } from "./reasons";

export async function withJobRouteErrors<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;

    if (
      error instanceof ConciliationRefusal ||
      isJobRefusal(error) ||
      isCreditRefusal(error)
    ) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    const stored = describeJobError(error, { step: "jobs.route" });
    return NextResponse.json(
      { error: stored.message, code: stored.code, correlationId: stored.correlationId },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
