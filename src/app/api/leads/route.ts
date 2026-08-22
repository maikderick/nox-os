import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/lib/funnel";
import { parseJsonArray } from "@/lib/utils";
import { Prisma } from "@prisma/client";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().optional(),
  category: z.string().optional(),
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  funnelStage: z.string().optional(),
  source: z.string().optional(),
  websiteStatus: z.string().optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
  optIn: z.string().optional(),
  best: z.enum(["true", "false"]).optional(),
  minScore: z.coerce.number().optional(),
  maxScore: z.coerce.number().optional(),
  minConfidence: z.coerce.number().optional(),
  maxDistance: z.coerce.number().optional(),
  sort: z
    .enum([
      "score_desc",
      "score_asc",
      "distance_asc",
      "distance_desc",
      "name_asc",
      "verified_desc",
      "confidence_desc",
      "closing_desc",
    ])
    .default("score_desc"),
  includeDemo: z.enum(["true", "false"]).optional(),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const p = parsed.data;
  const where: Prisma.BusinessWhereInput = {};

  if (p.includeDemo !== "true") {
    where.isDemo = false;
  }

  if (p.q) {
    where.OR = [
      { name: { contains: p.q, mode: "insensitive" } },
      { address: { contains: p.q, mode: "insensitive" } },
      { city: { contains: p.q, mode: "insensitive" } },
      { category: { contains: p.q, mode: "insensitive" } },
    ];
  }
  if (p.category) where.category = { contains: p.category, mode: "insensitive" };
  if (p.city) where.city = { contains: p.city, mode: "insensitive" };
  if (p.neighborhood) {
    where.neighborhood = { contains: p.neighborhood, mode: "insensitive" };
  }
  const hasValidFunnel =
    p.funnelStage && (FUNNEL_STAGES as readonly string[]).includes(p.funnelStage);
  if (hasValidFunnel) {
    where.funnelStage = p.funnelStage;
  }
  if (p.source) where.source = p.source;
  if (p.websiteStatus) where.websiteStatus = p.websiteStatus;
  if (p.best === "true" || p.hasPhone === "true") where.phoneE164 = { not: null };
  if (p.best !== "true" && p.hasPhone === "false") where.phoneE164 = null;

  const minimumScore =
    p.best === "true" ? Math.max(70, p.minScore ?? 70) : p.minScore;
  if (minimumScore != null || p.maxScore != null) {
    where.opportunityScore = {};
    if (minimumScore != null) where.opportunityScore.gte = minimumScore;
    if (p.maxScore != null) where.opportunityScore.lte = p.maxScore;
  }
  const minimumConfidence =
    p.best === "true" ? Math.max(70, p.minConfidence ?? 70) : p.minConfidence;
  if (minimumConfidence != null) {
    where.confidenceScore = { gte: minimumConfidence };
  }
  if (p.maxDistance != null) {
    where.distanceKm = { lte: p.maxDistance };
  }
  if (p.optIn) {
    where.consents = { some: { optInStatus: p.optIn } };
  }

  if (p.best === "true") {
    where.doNotContact = false;
    where.suppressions = { none: {} };
    const excludedStages = ["cliente", "nao_interessado", "nao_contatar"];
    if (hasValidFunnel && excludedStages.includes(p.funnelStage!)) {
      // Keep the semantics of `best=true`: closed/lost/suppressed leads are never ranked.
      where.id = "__no_best_opportunity__";
    } else if (!hasValidFunnel) {
      where.funnelStage = { notIn: excludedStages };
    }
  }

  const orderBy:
    | Prisma.BusinessOrderByWithRelationInput
    | Prisma.BusinessOrderByWithRelationInput[] =
    p.sort === "closing_desc"
      ? [
          { opportunityScore: "desc" },
          { confidenceScore: "desc" },
          { distanceKm: { sort: "asc", nulls: "last" } },
          { name: "asc" },
        ]
      : p.sort === "score_asc"
      ? { opportunityScore: "asc" }
      : p.sort === "distance_asc"
        ? { distanceKm: "asc" }
        : p.sort === "distance_desc"
          ? { distanceKm: "desc" }
          : p.sort === "name_asc"
            ? { name: "asc" }
            : p.sort === "verified_desc"
              ? { lastVerifiedAt: "desc" }
              : p.sort === "confidence_desc"
                ? { confidenceScore: "desc" }
                : { opportunityScore: "desc" };

  const [total, items] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      orderBy,
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      include: {
        consents: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  return NextResponse.json({
    total,
    page: p.page,
    pageSize: p.pageSize,
    items: items.map((b) => ({
      ...b,
      scoreReasons: parseJsonArray(b.scoreReasons),
      socialLinks: parseJsonArray(b.socialLinks),
      optInStatus: b.consents[0]?.optInStatus ?? "unknown",
      consents: undefined,
    })),
  });
}
