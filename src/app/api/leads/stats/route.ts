import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoMode = process.env.DEMO_MODE === "true";
  const realWhere = { isDemo: false };
  const countWhere = demoMode ? {} : realWhere;

  const [
    total,
    high,
    mid,
    low,
    apto,
    contatados,
    respostas,
    reunioes,
    clientes,
    byCategory,
    byCity,
    settings,
  ] = await Promise.all([
    prisma.business.count({ where: countWhere }),
    prisma.business.count({ where: { ...countWhere, opportunityScore: { gte: 70 } } }),
    prisma.business.count({
      where: { ...countWhere, opportunityScore: { gte: 40, lt: 70 } },
    }),
    prisma.business.count({ where: { ...countWhere, opportunityScore: { lt: 40 } } }),
    prisma.business.count({
      where: {
        ...countWhere,
        doNotContact: false,
        funnelStage: "apto_whatsapp",
        consents: { some: { optInStatus: "verified" } },
      },
    }),
    prisma.business.count({ where: { ...countWhere, funnelStage: "contatado" } }),
    prisma.business.count({ where: { ...countWhere, funnelStage: "respondeu" } }),
    prisma.business.count({ where: { ...countWhere, funnelStage: "reuniao" } }),
    prisma.business.count({ where: { ...countWhere, funnelStage: "cliente" } }),
    prisma.business.groupBy({
      by: ["category"],
      where: countWhere,
      _count: { _all: true },
      orderBy: { _count: { category: "desc" } },
      take: 12,
    }),
    prisma.business.groupBy({
      by: ["city"],
      where: countWhere,
      _count: { _all: true },
      orderBy: { _count: { city: "desc" } },
      take: 12,
    }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
  ]);

  const goal = settings?.leadGoal ?? 1000;
  const realTotal = await prisma.business.count({ where: realWhere });

  return NextResponse.json({
    total,
    realTotal,
    demoMode,
    high,
    mid,
    low,
    apto,
    contatados,
    respostas,
    reunioes,
    clientes,
    goal,
    progressPct: Math.min(100, Math.round((realTotal / goal) * 100)),
    byCategory: byCategory.map((c) => ({
      name: c.category || "Sem categoria",
      count: c._count._all,
    })),
    byCity: byCity.map((c) => ({
      name: c.city || "Sem cidade",
      count: c._count._all,
    })),
  });
}
