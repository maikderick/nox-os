import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isDemoLandingExpired, toDemoLandingDto } from "@/lib/demo-landing";
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
  const current = await prisma.demoLanding.findUnique({ where: { id } });
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

  const effectiveStatus = isDemoLandingExpired(requestedExpiry)
    ? "EXPIRED"
    : (body.data.status ?? current.status);

  const approvedAt =
    effectiveStatus === "APPROVED"
      ? current.approvedAt ?? new Date()
      : effectiveStatus === "DRAFT"
        ? null
        : current.approvedAt;

  const landing = await prisma.demoLanding.update({
    where: { id },
    data: {
      contentJson: body.data.content ? JSON.stringify(body.data.content) : undefined,
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
      status: landing.status,
      expiresAt: landing.expiresAt.toISOString(),
    },
  });

  return NextResponse.json({
    landing: toDemoLandingDto(landing, new URL(req.url).origin),
  });
}
