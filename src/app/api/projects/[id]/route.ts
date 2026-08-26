import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { withSiteFactoryErrors } from "@/lib/site-factory/route-errors";
import {
  getSiteProject,
  transitionSiteProject,
} from "@/lib/site-factory/project-service";
import { SITE_PROJECT_STATES } from "@/lib/site-factory/states";

type Context = { params: Promise<{ id: string }> };

const updateProjectSchema = z.object({ status: z.enum(SITE_PROJECT_STATES) }).strict();

export async function GET(_request: Request, context: Context) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:read");
    const { id } = await context.params;
    return NextResponse.json({ project: await getSiteProject(actor, id) });
  });
}

export async function PATCH(request: Request, context: Context) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:write");
    const body = updateProjectSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }
    const { id } = await context.params;
    const project = await transitionSiteProject({ actor, siteProjectId: id, to: body.data.status });
    return NextResponse.json({ project });
  });
}
