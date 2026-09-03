import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/authz/dal";
import { getDemoAiConfig, improveDemoLandingContent } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { demoExpiryDate, isDemoLandingExpired, toDemoLandingDto } from "@/lib/demo-landing";
import { buildDemoAiFacts } from "@/lib/demo-landing-ai";
import { applyStockPhotos, fetchDemoStockPhotos } from "@/lib/demo-landing-photos";
import { markExpiredIfNeeded, saveGeneratedDemoLanding } from "@/lib/demo-landing-store";
import { writeAudit } from "@/lib/settings";
import { siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import { withSiteFactoryErrors } from "@/lib/site-factory/route-errors";
import { buildSiteContentFromBrief } from "@/lib/site-generator";
import { hasOwnWebsite } from "@/lib/website";

/** Photos plus an optional Claude pass; leave room for one retry. */
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

/** How long a fresh preview stays online before someone decides about it. */
const PREVIEW_DAYS = 14;
/** "Permanent" in a system built around expiry: far enough to never be hit. */
const PERMANENT_DAYS = 3650;
/** Anything further than a year out is treated as permanent. */
const PERMANENT_THRESHOLD_MS = 365 * 86_400_000;

const generateSchema = z
  .object({
    expiresInDays: z.number().int().min(1).max(90).default(PREVIEW_DAYS),
  })
  .strict();

const updateSchema = z
  .object({
    action: z.enum(["tornar_permanente", "renovar", "encerrar"]),
  })
  .strict();

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

async function loadLanding(businessId: string) {
  const stored = await prisma.demoLanding.findUnique({ where: { businessId } });
  return stored ? markExpiredIfNeeded(stored) : null;
}

export async function GET(request: Request, context: Context) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:read");
    const { id } = await context.params;
    const project = await getSiteProject(actor, id);
    const businessId = project.client.businessId;
    const landing = businessId ? await loadLanding(businessId) : null;
    return NextResponse.json({
      site: landing ? toDemoLandingDto(landing, requestOrigin(request)) : null,
      ai: { configured: getDemoAiConfig().configured },
    });
  });
}

/**
 * Builds (or rebuilds) the client's site from the project's current brief.
 *
 * The brief is the review: every field in it was confirmed by the operator,
 * so the page goes online at once. It is still a preview — it expires unless
 * someone makes it permanent — and it never touches a real repository or
 * hosting project.
 */
export async function POST(request: Request, context: Context) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:write");
    const body = generateSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const { id } = await context.params;
    const project = await getSiteProject(actor, id);
    const business = project.client.business;
    if (!project.client.businessId || !business) {
      return NextResponse.json(
        { error: "Este projeto não está ligado a um negócio da prospecção.", code: "sem_negocio" },
        { status: 409 },
      );
    }
    if (hasOwnWebsite(business.website)) {
      return NextResponse.json(
        { error: "Este negócio já tem site próprio; a prévia só é gerada para quem não tem.", code: "tem_site" },
        { status: 409 },
      );
    }

    const current = project.briefVersions.find((version) => version.id === project.currentBriefVersionId)
      ?? project.briefVersions[0];
    if (!current) {
      return NextResponse.json(
        { error: "O projeto ainda não tem briefing confirmado.", code: "sem_briefing" },
        { status: 409 },
      );
    }
    const brief = siteBriefSchema.parse(JSON.parse(current.contentJson));
    if (brief.schemaVersion !== 2) {
      return NextResponse.json(
        { error: "O briefing é da versão 1. Confirme serviços e contato numa versão nova.", code: "briefing_v1" },
        { status: 409 },
      );
    }

    let content = buildSiteContentFromBrief({
      brief,
      lead: {
        city: business.city,
        state: business.state,
        latitude: business.latitude,
        longitude: business.longitude,
      },
    });
    const photos = await fetchDemoStockPhotos(brief.sector.value);
    content = applyStockPhotos(content, photos);

    let improvedByAi = false;
    if (getDemoAiConfig().configured) {
      // Optional polish. A refusal, a timeout or a fabricated claim all leave
      // the deterministic copy exactly as it is.
      try {
        const improved = await improveDemoLandingContent({ current: content, facts: buildDemoAiFacts(content) });
        content = improved.content;
        improvedByAi = true;
      } catch {
        improvedByAi = false;
      }
    }

    // A permanent site keeps its date through a regeneration; only a preview
    // gets a fresh 14-day window.
    const existing = await prisma.demoLanding.findUnique({ where: { businessId: business.id } });
    const keepExpiry =
      existing && existing.status === "APPROVED" && existing.expiresAt.getTime() - Date.now() > PERMANENT_THRESHOLD_MS
        ? existing.expiresAt
        : null;
    const landing = await saveGeneratedDemoLanding({
      business: { id: business.id, name: brief.businessName.value },
      content,
      createdById: actor.userId,
      expiresInDays: body.data.expiresInDays,
      expiresAt: keepExpiry ?? undefined,
      status: "APPROVED",
    });

    await setProjectStatus(project.id, actor.organizationId, "PREVIA_PRONTA", "Prévia no ar");
    await writeAudit({
      userId: actor.userId,
      action: "site.preview_generated",
      entity: "SiteProject",
      entityId: project.id,
      meta: { landingId: landing.id, slug: landing.slug, expiresAt: landing.expiresAt.toISOString(), improvedByAi },
    });

    return NextResponse.json(
      { site: toDemoLandingDto(landing, requestOrigin(request)), improvedByAi },
      { status: 201 },
    );
  });
}

export async function PATCH(request: Request, context: Context) {
  return withSiteFactoryErrors(async () => {
    const actor = await requirePermission("project:write");
    const body = updateSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const { id } = await context.params;
    const project = await getSiteProject(actor, id);
    const businessId = project.client.businessId;
    const landing = businessId ? await prisma.demoLanding.findUnique({ where: { businessId } }) : null;
    if (!landing) {
      return NextResponse.json({ error: "Este projeto ainda não tem site gerado.", code: "sem_site" }, { status: 404 });
    }

    const action = body.data.action;
    // Making a site permanent is the publishing decision; it takes the same
    // permission the state machine asks for.
    if (action === "tornar_permanente" && !actor.permissions.includes("publish:approve")) {
      return NextResponse.json(
        { error: "Tornar o site permanente exige a permissão de aprovar publicação.", code: "sem_permissao" },
        { status: 403 },
      );
    }
    const updated = await prisma.demoLanding.update({
      where: { id: landing.id },
      data:
        action === "encerrar"
          ? { status: "EXPIRED" }
          : {
              status: "APPROVED",
              approvedAt: landing.approvedAt ?? new Date(),
              expiresAt: demoExpiryDate(action === "tornar_permanente" ? PERMANENT_DAYS : PREVIEW_DAYS),
            },
    });

    if (action === "tornar_permanente") {
      await setProjectStatus(project.id, actor.organizationId, "APROVADO", "Site aprovado pelo cliente");
    } else if (action === "encerrar") {
      await setProjectStatus(project.id, actor.organizationId, "EM_REVISAO", "Prévia encerrada");
    }
    await writeAudit({
      userId: actor.userId,
      action: `site.${action}`,
      entity: "SiteProject",
      entityId: project.id,
      meta: { landingId: landing.id, expiresAt: updated.expiresAt.toISOString() },
    });

    return NextResponse.json({
      site: toDemoLandingDto(updated, requestOrigin(request)),
      expired: isDemoLandingExpired(updated.expiresAt) || updated.status === "EXPIRED",
    });
  });
}

/**
 * The preview path is its own orchestrator: it reports where the project is
 * instead of asking the state machine for permission, the same way a
 * generation run would. Scoped to the organization so a project id from
 * elsewhere is never touched.
 */
async function setProjectStatus(
  projectId: string,
  organizationId: string,
  status: "PREVIA_PRONTA" | "APROVADO" | "EM_REVISAO",
  message: string,
) {
  await prisma.siteProject.updateMany({
    where: { id: projectId, organizationId },
    data: { status, statusMessage: message },
  });
}
