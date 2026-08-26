import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz/dal";
import { authorized } from "@/lib/authz/route";
import { prisma } from "@/lib/db";

/** Retention cleanup: delete businesses older than retentionDays (except clients). */
export const POST = authorized(async () => {
  await requirePermission("data:purge");

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const days = settings?.retentionDays ?? 365;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await prisma.business.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      funnelStage: { notIn: ["cliente", "proposta", "reuniao"] },
      doNotContact: false,
      client: { is: null },
    },
  });

  return NextResponse.json({ deleted: result.count, cutoff, retentionDays: days });
});
