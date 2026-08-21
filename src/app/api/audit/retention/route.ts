import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Retention cleanup: delete businesses older than retentionDays (except clients). */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const days = settings?.retentionDays ?? 365;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await prisma.business.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      funnelStage: { notIn: ["cliente", "proposta", "reuniao"] },
      doNotContact: false,
    },
  });

  return NextResponse.json({ deleted: result.count, cutoff, retentionDays: days });
}
