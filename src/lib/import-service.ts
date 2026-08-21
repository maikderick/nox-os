import { prisma } from "./db";
import { normalizeName } from "./dedupe";
import { distanceKm, roundDistance } from "./distance";
import { normalizePhoneE164 } from "./phone";
import { findDuplicate, mergePreferringNonEmpty } from "./dedupe";
import { scoreOpportunity } from "./score";
import type { PlaceRecord } from "./places/types";
import { DEFAULT_RADII_KM } from "./funnel";

const FRANCHISE_HINTS = [
  "mcdonald",
  "burger king",
  "subway",
  "habib",
  "starbucks",
  "o boticario",
  "renner",
  "magazine luiza",
  "americanas",
];

function looksLikeFranchise(name: string): boolean {
  const n = name.toLowerCase();
  return FRANCHISE_HINTS.some((h) => n.includes(h));
}

export type ImportStats = {
  found: number;
  accepted: number;
  duplicate: number;
  rejected: number;
};

export async function upsertPlaces(
  places: PlaceRecord[],
  origin: { lat: number; lng: number } | null,
  settings: {
    franchisePenalty: number;
    modernSitePenalty: number;
    staleDataPenalty: number;
    maxRadiusKm: number;
  },
  isDemo = false,
): Promise<ImportStats> {
  const stats: ImportStats = { found: places.length, accepted: 0, duplicate: 0, rejected: 0 };

  const existing = await prisma.business.findMany({
    select: {
      id: true,
      source: true,
      externalId: true,
      name: true,
      address: true,
      phoneE164: true,
      website: true,
      latitude: true,
      longitude: true,
      socialLinks: true,
      category: true,
      city: true,
      state: true,
      neighborhood: true,
      phoneRaw: true,
      websiteStatus: true,
    },
  });

  const working = existing.map((e) => ({
    id: e.id,
    source: e.source,
    externalId: e.externalId,
    name: e.name,
    address: e.address,
    phoneE164: e.phoneE164,
    website: e.website,
    latitude: e.latitude,
    longitude: e.longitude,
  }));

  for (const place of places) {
    if (!place.name?.trim()) {
      stats.rejected += 1;
      continue;
    }

    const phoneE164 = normalizePhoneE164(place.phoneRaw);
    const dist =
      origin && place.latitude != null && place.longitude != null
        ? roundDistance(distanceKm(origin.lat, origin.lng, place.latitude, place.longitude))
        : null;

    const dup = findDuplicate(
      {
        source: place.source,
        externalId: place.externalId,
        name: place.name,
        address: place.address,
        phoneE164,
        website: place.website,
        latitude: place.latitude,
        longitude: place.longitude,
      },
      working,
    );

    const scored = scoreOpportunity(
      {
        website: place.website,
        websiteStatus: place.website
          ? "unknown"
          : (place.socialLinks?.length ?? 0) > 0
            ? "social_only"
            : "not_reported",
        socialLinks: place.socialLinks,
        category: place.category,
        phoneE164,
        distanceKm: dist,
        isActiveHint: true,
        dataFreshDays: 0,
        looksLikeFranchise: looksLikeFranchise(place.name),
        maxRadiusKm: settings.maxRadiusKm,
        sourceConfidenceBoost: place.source === "overpass" ? 10 : 5,
      },
      {
        franchise: settings.franchisePenalty,
        modernSite: settings.modernSitePenalty,
        stale: settings.staleDataPenalty,
      },
    );

    if (dup?.match.id) {
      stats.duplicate += 1;
      const current = existing.find((e) => e.id === dup.match.id);
      if (!current) continue;

      const { merged, conflicts } = mergePreferringNonEmpty(
        {
          phoneRaw: current.phoneRaw,
          phoneE164: current.phoneE164,
          website: current.website,
          address: current.address,
          city: current.city,
          state: current.state,
          neighborhood: current.neighborhood,
          category: current.category,
        },
        {
          phoneRaw: place.phoneRaw ?? null,
          phoneE164,
          website: place.website ?? null,
          address: place.address ?? null,
          city: place.city ?? null,
          state: place.state ?? null,
          neighborhood: place.neighborhood ?? null,
          category: place.category,
        },
        place.source,
      );

      await prisma.business.update({
        where: { id: dup.match.id },
        data: {
          ...merged,
          lastVerifiedAt: new Date(),
          distanceKm: dist ?? undefined,
          opportunityScore: scored.opportunityScore,
          confidenceScore: scored.confidenceScore,
          scoreReasons: JSON.stringify(scored.reasons),
        },
      });

      await prisma.businessSource.create({
        data: {
          businessId: dup.match.id,
          source: place.source,
          externalId: place.externalId,
          fieldName: "merge",
          fieldValue: JSON.stringify({ conflicts, reasons: dup.reason }),
          rawPayload: JSON.stringify(place.raw ?? null),
        },
      });
      continue;
    }

    const created = await prisma.business.create({
      data: {
        externalId: place.externalId,
        source: place.source,
        name: place.name,
        nameNormalized: normalizeName(place.name),
        category: place.category,
        address: place.address,
        neighborhood: place.neighborhood,
        city: place.city,
        state: place.state,
        postalCode: place.postalCode,
        latitude: place.latitude,
        longitude: place.longitude,
        distanceKm: dist,
        phoneRaw: place.phoneRaw,
        phoneE164,
        website: place.website,
        websiteStatus: place.website
          ? "unknown"
          : (place.socialLinks?.length ?? 0) > 0
            ? "social_only"
            : "not_reported",
        socialLinks: JSON.stringify(place.socialLinks ?? []),
        sourceUrl: place.sourceUrl,
        opportunityScore: scored.opportunityScore,
        confidenceScore: scored.confidenceScore,
        scoreReasons: JSON.stringify(scored.reasons),
        isDemo,
        funnelStage: "novo",
      },
    });

    await prisma.scoreResult.create({
      data: {
        businessId: created.id,
        opportunityScore: scored.opportunityScore,
        confidenceScore: scored.confidenceScore,
        reasonsJson: JSON.stringify(scored.reasons),
        breakdownJson: JSON.stringify(scored.breakdown),
      },
    });

    await prisma.consentRecord.create({
      data: {
        businessId: created.id,
        optInStatus: "unknown",
      },
    });

    await prisma.businessSource.create({
      data: {
        businessId: created.id,
        source: place.source,
        externalId: place.externalId,
        fieldName: "record",
        fieldValue: place.name,
        rawPayload: JSON.stringify(place.raw ?? null),
      },
    });

    working.push({
      id: created.id,
      source: created.source,
      externalId: created.externalId,
      name: created.name,
      address: created.address,
      phoneE164: created.phoneE164,
      website: created.website,
      latitude: created.latitude,
      longitude: created.longitude,
    });
    stats.accepted += 1;
  }

  return stats;
}

export async function runOverpassImportJob(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || !job.originLat || !job.originLng) return;

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const { OverpassPlacesProvider } = await import("./places/overpass");
  const provider = new OverpassPlacesProvider();
  const radii: number[] = JSON.parse(job.radiiKm) as number[];
  const categories: string[] = JSON.parse(job.categories) as string[];
  const goal = settings?.leadGoal ?? 1000;
  const demoMode = process.env.DEMO_MODE === "true";

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), errorMessage: null },
  });

  let totals = { found: 0, accepted: 0, duplicate: 0, rejected: 0 };

  try {
    for (const radiusKm of radii.length ? radii : [...DEFAULT_RADII_KM]) {
      const fresh = await prisma.importJob.findUnique({ where: { id: jobId } });
      if (!fresh || fresh.status === "cancelled" || fresh.status === "paused") return;

      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          currentRadiusKm: radiusKm,
          progressJson: JSON.stringify({ phase: "search", radiusKm }),
        },
      });

      const result = await provider.search({
        area: { lat: job.originLat, lng: job.originLng, radiusKm, label: job.originLabel ?? undefined },
        categoryIds: categories,
      });

      const realCount = await prisma.business.count({ where: { isDemo: false } });
      if (realCount >= goal) break;

      const stats = await upsertPlaces(
        result.places,
        { lat: job.originLat, lng: job.originLng },
        {
          franchisePenalty: settings?.franchisePenalty ?? 15,
          modernSitePenalty: settings?.modernSitePenalty ?? 20,
          staleDataPenalty: settings?.staleDataPenalty ?? 10,
          maxRadiusKm: settings?.maxRadiusKm ?? 80,
        },
        demoMode,
      );

      totals = {
        found: totals.found + stats.found,
        accepted: totals.accepted + stats.accepted,
        duplicate: totals.duplicate + stats.duplicate,
        rejected: totals.rejected + stats.rejected,
      };

      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          foundCount: totals.found,
          acceptedCount: totals.accepted,
          duplicateCount: totals.duplicate,
          rejectedCount: totals.rejected,
          progressJson: JSON.stringify({
            phase: "radius_done",
            radiusKm,
            attribution: result.attribution,
          }),
        },
      });

      const after = await prisma.business.count({ where: { isDemo: false } });
      if (after >= goal) break;
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "completed", finishedAt: new Date() },
    });
  } catch (err) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Erro na importação",
        finishedAt: new Date(),
      },
    });
  }
}
