import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { withAuthorization } from "@/lib/authz/route";
import { siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { createSiteBriefVersion } from "@/lib/site-factory/brief-service";
import { convertBusinessToClient } from "@/lib/site-factory/client-service";
import { createSiteProject, listSiteProjects } from "@/lib/site-factory/project-service";
import { plainText } from "@/lib/zod-text";

const createProjectSchema = z
  .object({
    businessId: z.string().trim().min(1).max(128),
    name: plainText(160),
    sector: plainText(160),
    brief: siteBriefSchema,
  })
  .strict();

export async function GET() {
  return withAuthorization(async () => {
    const actor = await requirePermission("project:read");
    return NextResponse.json({ projects: await listSiteProjects(actor) });
  });
}

export async function POST(request: Request) {
  return withAuthorization(async () => {
    const actor = await requirePermission("project:write");
    const body = createProjectSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const client = await convertBusinessToClient({ actor, businessId: body.data.businessId });
    const project = await createSiteProject({
      actor,
      clientId: client.id,
      name: body.data.name,
      sector: body.data.sector,
    });
    const briefVersion = await createSiteBriefVersion({
      actor,
      siteProjectId: project.id,
      brief: body.data.brief,
    });

    return NextResponse.json({ project: { ...project, status: "BRIEFING_PRONTO" }, client, briefVersion }, { status: 201 });
  });
}
