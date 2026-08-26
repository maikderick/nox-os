import type { Prisma } from "@prisma/client";

import { prisma } from "./db";

/**
 * Either the pooled client or one bound to an open transaction, so a caller can
 * make an audit entry part of the same unit of work as the change it describes.
 */
type AuditDb = Prisma.TransactionClient;

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

/**
 * Records what happened.
 *
 * `db` takes a transaction client so an entry and the change it describes commit
 * or roll back together. Without it, a change could land with no trace, or a
 * trace could survive a change that was rolled back — and an incident review
 * cannot tell which of the two it is looking at.
 */
export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: unknown;
  db?: AuditDb;
}) {
  const db = params.db ?? prisma;
  const userId = params.userId
    ? (
        await db.user.findUnique({
          where: { id: params.userId },
          select: { id: true },
        })
      )?.id ?? null
    : null;
  await db.auditLog.create({
    data: {
      userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      metaJson: params.meta ? JSON.stringify(params.meta) : null,
    },
  });
}
