import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ensureDemoBusinessSnapshot,
  isDemoLandingExpired,
  preserveDemoBusinessSnapshot,
  toDemoLandingDto,
} from "@/lib/demo-landing";
import { updateDemoLandingSchema } from "@/lib/demo-landing-schema";
import { writeAudit } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const body = updateDemoLandingSchema.safeParse(payload);
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const { id } = await ctx.params;
  const current = await prisma.demoLanding.findUnique({
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
  if (!current) {
    return NextResponse.json({ error: "Demonstração não encontrada" }, { status: 404 });
  }

  const requestedExpiry = body.data.expiresAt ? new Date(body.data.expiresAt) : current.expiresAt;
  if (body.data.status === "APPROVED" && isDemoLandingExpired(requestedExpiry)) {
    return NextResponse.json(
      { error: "Defina uma validade futura antes de aprovar a demonstração." },
      { status: 400 },
    );
  }

  // Any content change sends an approved demo back to draft, so a shared link can
  // never point at copy nobody approved. Approving is the only way out.
  const returnsToDraft = body.data.content !== undefined && body.data.status !== "APPROVED";

  const effectiveStatus = isDemoLandingExpired(requestedExpiry)
    ? "EXPIRED"
    : returnsToDraft
      ? "DRAFT"
      : (body.data.status ?? current.status);

  const approvedAt =
    effectiveStatus === "APPROVED"
      ? current.approvedAt ?? new Date()
      : effectiveStatus === "DRAFT"
        ? null
        : current.approvedAt;

  const snapshot = body.data.content
    ? preserveDemoBusinessSnapshot({
        currentContentJson: current.contentJson,
        requestedContent: body.data.content,
        business: current.business,
      })
    : ensureDemoBusinessSnapshot(current.contentJson, current.business);
  const shouldWriteContent = body.data.content !== undefined || snapshot.captured;

  const landing = await prisma.demoLanding.update({
    where: { id },
    data: {
      contentJson: shouldWriteContent ? JSON.stringify(snapshot.content) : undefined,
      status: effectiveStatus,
      expiresAt: body.data.expiresAt ? requestedExpiry : undefined,
      approvedAt,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "demo_landing.updated",
    entity: "DemoLanding",
    entityId: landing.id,
    meta: {
      changedContent: body.data.content !== undefined,
      returnedToDraft: returnsToDraft && current.status === "APPROVED",
      capturedBusinessSnapshot: snapshot.captured,
      status: landing.status,
      expiresAt: landing.expiresAt.toISOString(),
    },
  });

  return NextResponse.json({
    landing: toDemoLandingDto(landing, new URL(req.url).origin),
  });
}
