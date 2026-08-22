import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isLeadEligibleByWebsite } from "@/lib/website";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const demoMode = process.env.DEMO_MODE === "true";
  const includeWithWebsite = new URL(req.url).searchParams.get("includeWithWebsite") === "true";
  const [allBusinesses, settings] = await Promise.all([
    prisma.business.findMany({
      select: {
        website: true,
        isDemo: true,
        opportunityScore: true,
        doNotContact: true,
        funnelStage: true,
        category: true,
        city: true,
        consents: {
          where: { optInStatus: "verified" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
  ]);

  const eligibleBusinesses = includeWithWebsite
    ? allBusinesses
    : allBusinesses.filter((business) => isLeadEligibleByWebsite(business.website));
  const realBusinesses = eligibleBusinesses.filter((business) => !business.isDemo);
  const businesses = demoMode ? eligibleBusinesses : realBusinesses;

  const total = businesses.length;
  const high = businesses.filter((business) => business.opportunityScore >= 70).length;
  const mid = businesses.filter(
    (business) => business.opportunityScore >= 40 && business.opportunityScore < 70,
  ).length;
  const low = businesses.filter((business) => business.opportunityScore < 40).length;
  const apto = businesses.filter(
    (business) =>
      !business.doNotContact &&
      business.funnelStage === "apto_whatsapp" &&
      business.consents.length > 0,
  ).length;
  const contatados = businesses.filter((business) => business.funnelStage === "contatado").length;
  const respostas = businesses.filter((business) => business.funnelStage === "respondeu").length;
  const reunioes = businesses.filter((business) => business.funnelStage === "reuniao").length;
  const clientes = businesses.filter((business) => business.funnelStage === "cliente").length;

  const groupTop = (field: "category" | "city") => {
    const counts = new Map<string, number>();
    for (const business of businesses) {
      const key = business[field] ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  };

  const goal = settings?.leadGoal ?? 1000;
  const realTotal = realBusinesses.length;

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
    byCategory: groupTop("category").map((item) => ({
      name: item.name || "Sem categoria",
      count: item.count,
    })),
    byCity: groupTop("city").map((item) => ({
      name: item.name || "Sem cidade",
      count: item.count,
    })),
  });
}
