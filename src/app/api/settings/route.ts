import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/settings";
import { settingsForClient } from "@/lib/settings-serialization";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return NextResponse.json({
    settings: settings ? settingsForClient(settings) : null,
    envHints: {
      demoMode: process.env.DEMO_MODE === "true",
      hasNextAuthSecret: Boolean(process.env.NEXTAUTH_SECRET),
    },
  });
}

const updateSchema = z.object({
  brandName: z.string().min(1).optional(),
  sellerName: z.string().min(1).optional(),
  defaultCity: z.string().min(1).optional(),
  leadGoal: z.number().int().min(1).max(100000).optional(),
  initialRadiusKm: z.number().min(1).max(200).optional(),
  maxRadiusKm: z.number().min(1).max(200).optional(),
  privacyEmail: z.string().optional(),
  portfolioUrl: z.string().optional(),
  whatsappPhone: z.string().optional(),
  whatsappTemplate: z.string().optional(),
  originLat: z.number().nullable().optional(),
  originLng: z.number().nullable().optional(),
  originLabel: z.string().nullable().optional(),
  franchisePenalty: z.number().int().optional(),
  modernSitePenalty: z.number().int().optional(),
  staleDataPenalty: z.number().int().optional(),
  enabledCategories: z.array(z.string()).optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),
});

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = updateSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const { enabledCategories, ...rest } = body.data;
  const settings = await prisma.appSettings.update({
    where: { id: "default" },
    data: {
      ...rest,
      ...(enabledCategories ? { enabledCategories: JSON.stringify(enabledCategories) } : {}),
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "settings.update",
    entity: "AppSettings",
    entityId: "default",
    meta: body.data,
  });

  return NextResponse.json({ settings: settingsForClient(settings) });
}
