import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import {
  DemoAiError,
  getDemoAiConfig,
  improveDemoLandingContent,
  toDemoAiError,
  type DemoAiErrorCode,
} from "@/lib/anthropic";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildDemoAiFacts } from "@/lib/demo-landing-ai";
import {
  countRecentDemoAiRequests,
  DEMO_AI_REQUEST_ACTION,
  DEMO_AI_SUGGESTION_ACTION,
} from "@/lib/demo-landing-ai-usage";
import { ensureDemoBusinessSnapshot, isDemoLandingExpired } from "@/lib/demo-landing";
import { writeAudit } from "@/lib/settings";
import { hasOwnWebsite } from "@/lib/website";

/** The improvement is a single non-streaming call; keep room for one retry. */
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const ERROR_STATUS: Record<DemoAiErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  rate_limited: 429,
  unauthorized: 502,
  refused: 422,
  invalid_response: 422,
  upstream: 502,
};

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const config = getDemoAiConfig();
  if (!config.configured) {
    const error = new DemoAiError("not_configured");
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: ERROR_STATUS.not_configured },
    );
  }

  const { id } = await ctx.params;
  const landing = await prisma.demoLanding.findUnique({
    where: { id },
    include: {
      business: {
        select: {
          name: true,
          category: true,
          address: true,
          neighborhood: true,
          city: true,
          state: true,
          postalCode: true,
          phoneE164: true,
          socialLinks: true,
          website: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
  if (!landing) {
    return NextResponse.json({ error: "Demonstração não encontrada" }, { status: 404 });
  }
  if (hasOwnWebsite(landing.business.website)) {
    return NextResponse.json(
      { error: "Este lead já possui site próprio e não é elegível para demonstração." },
      { status: 409 },
    );
  }
  if (landing.status === "EXPIRED" || isDemoLandingExpired(landing.expiresAt)) {
    return NextResponse.json(
      { error: "Esta demonstração expirou. Renove a validade antes de melhorar o conteúdo." },
      { status: 409 },
    );
  }

  let current;
  try {
    current = ensureDemoBusinessSnapshot(landing.contentJson, landing.business).content;
  } catch {
    return NextResponse.json(
      { error: "O conteúdo armazenado desta demonstração está inválido. Gere-a novamente." },
      { status: 422 },
    );
  }

  const usedInWindow = await countRecentDemoAiRequests({ userId });
  if (usedInWindow >= config.hourlyLimit) {
    return NextResponse.json(
      {
        error: `Limite de ${config.hourlyLimit} melhorias por hora atingido. O gerador automático gratuito continua disponível.`,
        code: "rate_limited" satisfies DemoAiErrorCode,
      },
      { status: 429 },
    );
  }

  // Recorded before the call so a failed attempt still consumes quota.
  await writeAudit({
    userId,
    action: DEMO_AI_REQUEST_ACTION,
    entity: "DemoLanding",
    entityId: landing.id,
    meta: { model: config.model },
  });

  try {
    const improvement = await improveDemoLandingContent({
      current,
      facts: buildDemoAiFacts(current),
      model: config.model,
    });

    await writeAudit({
      userId,
      action: DEMO_AI_SUGGESTION_ACTION,
      entity: "DemoLanding",
      entityId: landing.id,
      meta: {
        model: improvement.model,
        attempts: improvement.attempts,
        changedFields: improvement.changedFields.length,
        droppedServices: improvement.droppedServices.length,
      },
    });

    // Deliberately not persisted: Claude never publishes, the reviewer applies.
    return NextResponse.json({
      suggestion: {
        content: improvement.content,
        changedFields: improvement.changedFields,
        droppedServices: improvement.droppedServices,
        model: improvement.model,
      },
    });
  } catch (cause) {
    const error = toDemoAiError(cause);
    console.error(`[demo-landing-ai] falha ${error.code}`);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: ERROR_STATUS[error.code] },
    );
  }
}
