import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDemoAiConfig } from "@/lib/anthropic";
import { toDemoLandingDto } from "@/lib/demo-landing";
import { createDemoLandingSchema } from "@/lib/demo-landing-schema";
import {
  captureLegacyDemoBusinessSnapshot,
  markExpiredIfNeeded,
  regenerateDemoLanding,
} from "@/lib/demo-landing-store";
import { writeAudit } from "@/lib/settings";
import { hasOwnWebsite } from "@/lib/website";

const getQuerySchema = z.object({
  leadId: z.string().trim().min(1).max(128),
});

function requestOrigin(req: Request): string {
  return new URL(req.url).origin;
}
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = getQuerySchema.safeParse({ leadId: url.searchParams.get("leadId") });
  if (!query.success) {
    return NextResponse.json({ error: query.error.flatten() }, { status: 400 });
  }

  const stored = await prisma.demoLanding.findUnique({
    where: { businessId: query.data.leadId },
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
  // Exposes only whether the optional Claude step is available — never the key.
  const aiConfig = getDemoAiConfig();
  const ai = { configured: aiConfig.configured, hourlyLimit: aiConfig.hourlyLimit };

  if (!stored) return NextResponse.json({ landing: null, ai });

  const snapshotted = await captureLegacyDemoBusinessSnapshot(stored, stored.business);
  const landing = await markExpiredIfNeeded(snapshotted);
  return NextResponse.json({ landing: toDemoLandingDto(landing, requestOrigin(req)), ai });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ALLOW_LEGACY_DEMO_LANDING_CREATION !== "true") {
    return NextResponse.json(
      {
        error:
          "A criação de landings demonstrativas foi encerrada. Crie um projeto na fábrica de sites.",
        code: "demo_landing_deprecated",
      },
      { status: 410 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const body = createDemoLandingSchema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const business = await prisma.business.findUnique({
    where: { id: body.data.leadId },
    select: {
      id: true,
      name: true,
      category: true,
      address: true,
      neighborhood: true,
      city: true,
      state: true,
      postalCode: true,
      phoneE164: true,
      socialLinks: true,
      latitude: true,
      longitude: true,
      website: true,
    },
  });
  if (!business) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }
  if (hasOwnWebsite(business.website)) {
    return NextResponse.json(
      { error: "A landing demonstrativa está disponível apenas para leads sem site próprio." },
      { status: 409 },
    );
  }

  try {
    const landing = await regenerateDemoLanding({
      business,
      createdById: session.user.id,
      expiresInDays: body.data.expiresInDays,
    });

    await writeAudit({
      userId: session.user.id,
      action: "demo_landing.generated",
      entity: "DemoLanding",
      entityId: landing.id,
      meta: { leadId: business.id, expiresAt: landing.expiresAt.toISOString() },
    });

    return NextResponse.json(
      { landing: toDemoLandingDto(landing, requestOrigin(req)) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    }
    throw error;
  }
}
