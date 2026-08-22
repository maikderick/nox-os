import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/lib/funnel";
import { Prisma } from "@prisma/client";
import { isLeadEligibleByWebsite } from "@/lib/website";

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
  minScore: z.coerce.number().optional(),
  maxScore: z.coerce.number().optional(),
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
    ])
    .default("score_desc"),
  includeDemo: z.enum(["true", "false"]).optional(),
  includeWithWebsite: z.enum(["true", "false"]).optional(),
});

type LeadWithConsents = Prisma.BusinessGetPayload<{
  include: { consents: true };
}>;

function serializeLead(b: LeadWithConsents) {
  return {
    ...b,
    scoreReasons: JSON.parse(b.scoreReasons || "[]"),
    socialLinks: JSON.parse(b.socialLinks || "[]"),
    optInStatus: b.consents[0]?.optInStatus ?? "unknown",
    consents: undefined,
  };
}

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
      { name: { contains: p.q } },
      { address: { contains: p.q } },
      { city: { contains: p.q } },
      { category: { contains: p.q } },
    ];
  }
  if (p.category) where.category = { contains: p.category };
  if (p.city) where.city = { contains: p.city };
  if (p.neighborhood) where.neighborhood = { contains: p.neighborhood };
  if (p.funnelStage && (FUNNEL_STAGES as readonly string[]).includes(p.funnelStage)) {
    where.funnelStage = p.funnelStage;
  }
  if (p.source) where.source = p.source;
  if (p.websiteStatus) where.websiteStatus = p.websiteStatus;
  if (p.hasPhone === "true") where.phoneE164 = { not: null };
  if (p.hasPhone === "false") where.phoneE164 = null;
  if (p.minScore != null || p.maxScore != null) {
    where.opportunityScore = {};
    if (p.minScore != null) where.opportunityScore.gte = p.minScore;
    if (p.maxScore != null) where.opportunityScore.lte = p.maxScore;
  }
  if (p.maxDistance != null) {
    where.distanceKm = { lte: p.maxDistance };
  }
  if (p.optIn) {
    where.consents = { some: { optInStatus: p.optIn } };
  }

  const orderBy: Prisma.BusinessOrderByWithRelationInput =
    p.sort === "score_asc"
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

  let total: number;
  let items: LeadWithConsents[];
  const consents = { orderBy: { createdAt: "desc" as const }, take: 1 };

  if (p.includeWithWebsite === "true") {
    [total, items] = await Promise.all([
      prisma.business.count({ where }),
      prisma.business.findMany({
        where,
        orderBy,
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        include: { consents },
      }),
    ]);
  } else {
    // Website classification includes platform/path rules which cannot be
    // represented reliably as a portable Prisma predicate. Select only the two
    // required columns first, then load the current page with its relations.
    const candidates = await prisma.business.findMany({
      where,
      orderBy,
      select: { id: true, website: true },
    });
    const eligibleIds = candidates
      .filter((business) => isLeadEligibleByWebsite(business.website))
      .map((business) => business.id);

    total = eligibleIds.length;
    const pageIds = eligibleIds.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
    if (pageIds.length === 0) {
      items = [];
    } else {
      const pageItems = await prisma.business.findMany({
        where: { id: { in: pageIds } },
        include: { consents },
      });
      const itemById = new Map(pageItems.map((business) => [business.id, business]));
      items = pageIds.flatMap((id) => {
        const business = itemById.get(id);
        return business ? [business] : [];
      });
    }
  }

  return NextResponse.json({
    total,
    page: p.page,
    pageSize: p.pageSize,
    items: items.map(serializeLead),
  });
}
