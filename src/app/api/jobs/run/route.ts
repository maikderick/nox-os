import { NextResponse } from "next/server";

import { assertPermission, requireActor } from "@/lib/authz/dal";
import { authorizationResponse } from "@/lib/authz/route";
import { runJobBatch } from "@/lib/jobs/consumer";
import { assertCronRequest, hasCronCredential } from "@/lib/jobs/cron-auth";
import { describeJobError } from "@/lib/jobs/error-record";

/**
 * The consumer's front door.
 *
 * Two ways in, and they are not interchangeable. The scheduler arrives with the
 * cron credential and no session; a person arrives with a session and no
 * credential, and needs `job:run` — seeing the queue is not deciding to work it.
 *
 * Which one is being attempted is decided by whether an `Authorization` header
 * is present, *before* either check runs. Falling back from a bad credential to
 * the session check would let a wrong secret produce a 403 about permissions,
 * which tells whoever is probing that the secret was the wrong part.
 */

/** The platform ceiling for this function. The lease is set above it. */
export const maxDuration = 300;

/**
 * How long the batch may keep working: the ceiling minus room to answer.
 *
 * Being killed mid-job is survivable — the lease lapses and the reclaim brings
 * it back — but it costs a recovery on a job that did nothing wrong, so the
 * budget stops first on purpose.
 */
const BUDGET_MS = 235_000;

export async function POST(request: Request) {
  try {
    if (hasCronCredential(request)) {
      assertCronRequest(request);
    } else {
      const actor = await requireActor();
      assertPermission(actor, "job:run");
    }

    const report = await runJobBatch({ budgetMs: BUDGET_MS });
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    const denied = authorizationResponse(error);
    if (denied) return denied;

    // Nothing is re-thrown: an unrecognised error reaching Next would be logged
    // by the framework with its message and its stack intact, which is the one
    // path that survives every other precaution.
    const stored = describeJobError(error, { step: "jobs.run" });
    return NextResponse.json(
      { error: stored.message, code: stored.code, correlationId: stored.correlationId },
      { status: 500 },
    );
  }
}
