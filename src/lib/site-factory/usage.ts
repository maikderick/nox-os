import "server-only";

import type { Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

export async function recordUsage(params: {
  actor: Actor;
  kind: string;
  quantity?: number;
  unit?: string;
  siteProjectId?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.usageLedger.create({
    data: {
      organizationId: params.actor.organizationId,
      siteProjectId: params.siteProjectId,
      kind: params.kind,
      quantity: params.quantity ?? 1,
      unit: params.unit ?? "execucao",
      reference: params.reference,
      metaJson: params.metadata ? JSON.stringify(params.metadata) : null,
      recordedById: params.actor.userId,
    },
  });
}
