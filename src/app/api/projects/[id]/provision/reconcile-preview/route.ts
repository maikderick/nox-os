import { NextResponse } from "next/server";

import { requireActor } from "@/lib/authz/dal";
import { reconcilePreview } from "@/lib/provisioning/step-preview";
import { withProvisioningErrors } from "@/lib/provisioning/route-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  return withProvisioningErrors(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    return NextResponse.json(await reconcilePreview({ actor, siteProjectId: id }));
  });
}
