import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { withSiteFactoryErrors } from "@/lib/site-factory/route-errors";
import { briefCapabilities, siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { createProjectWithBrief } from "@/lib/site-factory/project-intake";
import { listSiteProjects } from "@/lib/site-factory/project-service";
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
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:read");
    return NextResponse.json({ projects: await listSiteProjects(actor) });
  });
}

export async function POST(request: Request) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:write");
    const body = createProjectSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const { client, project, briefVersion } = await createProjectWithBrief({
      actor,
      businessId: body.data.businessId,
      name: body.data.name,
      sector: body.data.sector,
      brief: body.data.brief,
    });

    // The brief parses but may still be unable to describe a service page or a
    // way to reach the business. Reporting it here means the operator reads it
    // while the project is on screen, not when the site comes out incomplete.
    return NextResponse.json(
      {
        project,
        client,
        briefVersion,
        capabilities: briefCapabilities(body.data.brief),
      },
      { status: 201 },
    );
  });
}
