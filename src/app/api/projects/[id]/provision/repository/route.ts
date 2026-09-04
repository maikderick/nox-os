import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import { provisionRepository } from "@/lib/provisioning/step-repository";
import { withProvisioningErrors } from "@/lib/provisioning/route-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  return withProvisioningErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    const result = await provisionRepository({ actor, siteProjectId: id });
    return NextResponse.json(result, { status: result.alreadyDone ? 200 : 201 });
  });
}
