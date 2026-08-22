import { prisma } from "./db";

export async function ensureDefaultSettings() {
  return prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      brandName: process.env.BRAND_NAME ?? "NOX OS",
      sellerName: process.env.SELLER_NAME ?? "[SEU NOME]",
      defaultCity: process.env.DEFAULT_CITY ?? "[SUA CIDADE/UF]",
      leadGoal: Number(process.env.LEAD_GOAL ?? 1000),
      initialRadiusKm: Number(process.env.INITIAL_RADIUS_KM ?? 5),
      maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 80),
      privacyEmail: process.env.PRIVACY_EMAIL ?? "[SEU E-MAIL]",
      portfolioUrl: process.env.PORTFOLIO_URL ?? "[URL DO PORTFÓLIO]",
      whatsappPhone: process.env.NOX_WHATSAPP ?? "[SEU WHATSAPP]",
    },
    update: {},
  });
}

export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: unknown;
}) {
  const userId = params.userId
    ? (
        await prisma.user.findUnique({
          where: { id: params.userId },
          select: { id: true },
        })
      )?.id ?? null
    : null;
  await prisma.auditLog.create({
    data: {
      userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      metaJson: params.meta ? JSON.stringify(params.meta) : null,
    },
  });
}
