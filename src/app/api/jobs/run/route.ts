import { NextResponse } from "next/server";

import { assertPermission, requireActor } from "@/lib/authz/dal";
import { authorizationResponse } from "@/lib/authz/route";
import { runJobBatch, type JobBatchReport } from "@/lib/jobs/consumer";
import { assertCronRequest } from "@/lib/jobs/cron-auth";
import { describeJobError } from "@/lib/jobs/error-record";

/**
 * The consumer's front door — two doors, and neither opens the other.
 *
 * `GET` is the scheduler's, and only the scheduler's. Vercel Cron issues a GET
 * with `Authorization: Bearer <CRON_SECRET>`, and this consumer serves the
 * whole installation: it has no organization to be scoped to, because it works
 * for all of them.
 *
 * `POST` is a person's, and only a person's. It needs a session and `job:run`,
 * and it moves **only their organization's queue**. Letting it run the global
 * queue would mean one tenant's request executing another tenant's work,
 * recorded against their operator and spending their function budget.
 *
 * The split is by verb rather than by "whichever credential turned up" for a
 * reason worth stating: a single entrance that tries the cron secret and falls
 * back to the session answers 403 when the secret is wrong, which tells whoever
 * is probing that the secret was the wrong part. Here a wrong secret on GET is
 * 401 and never reaches a permission check, and a session on GET is not a
 * credential at all.
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

/** A worked queue is never a cacheable answer, whatever any layer assumes. */
function report(body: JobBatchReport): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

function failed(error: unknown): NextResponse {
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

/** The scheduler. Global queue, cron credential, no session anywhere in it. */
export async function GET(request: Request) {
  try {
    assertCronRequest(request);
    return report(await runJobBatch({ budgetMs: BUDGET_MS }));
  } catch (error) {
    return failed(error);
  }
}

/** A person. Their own queue, their own permission, no cron credential. */
export async function POST() {
  try {
    const actor = await requireActor();
    assertPermission(actor, "job:run");

    return report(
      await runJobBatch({ budgetMs: BUDGET_MS, organizationId: actor.organizationId }),
    );
  } catch (error) {
    return failed(error);
  }
}
