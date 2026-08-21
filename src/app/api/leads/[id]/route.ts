import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/lib/funnel";
import { writeAudit } from "@/lib/settings";
import { canOpenWhatsApp, buildWhatsAppLink, renderWhatsAppTemplate } from "@/lib/whatsapp";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const business = await prisma.business.findUnique({
    where: { id },
    include: {
      consents: { orderBy: { createdAt: "desc" } },
      contacts: { orderBy: { createdAt: "desc" }, take: 50 },
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      scores: { orderBy: { createdAt: "desc" }, take: 5 },
      sources: { orderBy: { collectedAt: "desc" }, take: 20 },
      suppressions: true,
    },
  });

  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...business,
    scoreReasons: JSON.parse(business.scoreReasons || "[]"),
    socialLinks: JSON.parse(business.socialLinks || "[]"),
  });
}

const patchSchema = z.object({
  funnelStage: z.enum(FUNNEL_STAGES).optional(),
  notesText: z.string().optional(),
  doNotContact: z.boolean().optional(),
  optInStatus: z.enum(["unknown", "pending", "verified", "refused"]).optional(),
  optInSource: z.string().optional(),
  optInPurpose: z.string().optional(),
  optInEvidence: z.string().optional(),
  note: z.string().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const data = body.data;
  const business = await prisma.business.findUnique({ where: { id } });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (data.doNotContact || data.funnelStage === "nao_contatar" || data.optInStatus === "refused") {
    await prisma.business.update({
      where: { id },
      data: {
        doNotContact: true,
        funnelStage: data.funnelStage ?? "nao_contatar",
        notesText: data.notesText,
      },
    });
    await prisma.suppressionEntry.create({
      data: {
        businessId: id,
        phoneE164: business.phoneE164,
        reason: data.optInStatus === "refused" ? "opt_in_refused" : "do_not_contact",
        evidence: data.optInEvidence ?? data.note ?? null,
      },
    });
    if (data.optInStatus === "refused") {
      await prisma.consentRecord.create({
        data: {
          businessId: id,
          optInStatus: "refused",
          source: data.optInSource,
          purpose: data.optInPurpose,
          evidence: data.optInEvidence,
          refusedAt: new Date(),
        },
      });
    }
  } else {
    await prisma.business.update({
      where: { id },
      data: {
        funnelStage: data.funnelStage,
        notesText: data.notesText,
        doNotContact: data.doNotContact,
      },
    });
  }

  if (data.optInStatus && data.optInStatus !== "refused") {
    await prisma.consentRecord.create({
      data: {
        businessId: id,
        optInStatus: data.optInStatus,
        source: data.optInSource,
        purpose: data.optInPurpose ?? "contato comercial sobre site personalizado NOX OS",
        evidence: data.optInEvidence,
        optedInAt: data.optInStatus === "verified" ? new Date() : null,
      },
    });
    if (data.optInStatus === "verified" && !business.doNotContact) {
      await prisma.business.update({
        where: { id },
        data: { funnelStage: data.funnelStage ?? "apto_whatsapp" },
      });
    }
  }

  if (data.note) {
    await prisma.note.create({
      data: {
        businessId: id,
        userId: session.user.id,
        body: data.note,
      },
    });
  }

  await writeAudit({
    userId: session.user.id,
    action: "business.patch",
    entity: "Business",
    entityId: id,
    meta: data,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.business.delete({ where: { id } });
  await writeAudit({
    userId: session.user.id,
    action: "business.delete",
    entity: "Business",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}

const waSchema = z.object({
  message: z.string().min(1),
  confirmPreview: z.literal(true),
});

/** Prepare a single manual wa.me link — never sends automatically. */
export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "whatsapp-link") {
    const body = waSchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const business = await prisma.business.findUnique({
      where: { id },
      include: {
        consents: { orderBy: { createdAt: "desc" }, take: 1 },
        suppressions: true,
      },
    });
    if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const optIn = business.consents[0]?.optInStatus ?? "unknown";
    const gate = canOpenWhatsApp({
      optInStatus: optIn,
      doNotContact: business.doNotContact,
      phoneE164: business.phoneE164,
      suppressed: business.suppressions.length > 0 || business.doNotContact,
    });

    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }

    const link = buildWhatsAppLink(business.phoneE164!, body.data.message);

    await prisma.contactAttempt.create({
      data: {
        businessId: id,
        userId: session.user.id,
        channel: "whatsapp",
        messagePreview: body.data.message,
        confirmedSent: false,
        outcome: "link_prepared",
      },
    });

    return NextResponse.json({
      link,
      optIn,
      consent: business.consents[0],
      notice: "Abertura manual de uma única conversa. Nenhum envio automático.",
    });
  }

  if (action === "confirm-sent") {
    const sentSchema = z.object({ sent: z.boolean() });
    const body = sentSchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    }

    const last = await prisma.contactAttempt.findFirst({
      where: { businessId: id, channel: "whatsapp" },
      orderBy: { createdAt: "desc" },
    });
    if (last) {
      await prisma.contactAttempt.update({
        where: { id: last.id },
        data: {
          confirmedSent: body.data.sent,
          outcome: body.data.sent ? "sent_confirmed" : "not_sent",
        },
      });
    }
    if (body.data.sent) {
      await prisma.business.update({
        where: { id },
        data: { funnelStage: "contatado" },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "preview-message") {
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const business = await prisma.business.findUnique({ where: { id } });
    if (!business || !settings) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const message = renderWhatsAppTemplate(settings.whatsappTemplate, {
      businessName: business.name,
      sellerName: settings.sellerName,
    });
    return NextResponse.json({ message });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
