import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import { provisionContent } from "@/lib/provisioning/step-content";
import { withProvisioningErrors } from "@/lib/provisioning/route-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  return withProvisioningErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    const result = await provisionContent({ actor, siteProjectId: id });
    return NextResponse.json(result);
  });
}
