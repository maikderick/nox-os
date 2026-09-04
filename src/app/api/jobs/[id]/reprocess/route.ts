import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import { reprocessDeadLetter } from "@/lib/jobs/dead-letter";
import { withJobRouteErrors } from "@/lib/jobs/route-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  return withJobRouteErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    const job = await reprocessDeadLetter(actor, id);
    return NextResponse.json(
      { jobId: job.id, status: job.status },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  });
}
