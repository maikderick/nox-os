import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import {
  ConciliationRefusal,
  isConciliationDecision,
  resolveJobConciliation,
} from "@/lib/jobs/conciliation";
import { withJobRouteErrors } from "@/lib/jobs/route-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withJobRouteErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { decision?: unknown; providerRunId?: unknown }
      | null;
    if (!isConciliationDecision(body?.decision)) {
      throw new ConciliationRefusal(
        "DECISAO_INVALIDA",
        "Escolha uma decisão de conciliação válida.",
      );
    }

    const result = await resolveJobConciliation({
      actor,
      jobId: id,
      decision: body.decision,
      ...(typeof body.providerRunId === "string" ? { providerRunId: body.providerRunId } : {}),
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  });
}
