import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/authz/dal";
import { withAuthorization } from "@/lib/authz/route";
import { briefCapabilities, siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { createSiteBriefVersion } from "@/lib/site-factory/brief-service";
import { getSiteProject } from "@/lib/site-factory/project-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return withAuthorization(async () => {
    const actor = await requirePermission("project:read");
    const { id } = await context.params;
    const project = await getSiteProject(actor, id);
    return NextResponse.json({ briefVersions: project.briefVersions });
  });
}

export async function POST(request: Request, context: Context) {
  return withAuthorization(async () => {
    const actor = await requirePermission("brief:write");
    const body = siteBriefSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }
    const { id } = await context.params;
    const briefVersion = await createSiteBriefVersion({
      actor,
      siteProjectId: id,
      brief: body.data,
    });
    // A v1 brief parses forever but names services without describing them.
    // Saying so on the way in beats discovering it when the site comes out
    // without service pages.
    return NextResponse.json(
      { briefVersion, capabilities: briefCapabilities(body.data) },
      { status: 201 },
    );
  });
}
