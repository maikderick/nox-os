import { prisma } from "./db";
import { normalizeName } from "./dedupe";
import { distanceKm, roundDistance } from "./distance";
import { normalizePhoneE164 } from "./phone";
import { findDuplicate, mergePreferringNonEmpty } from "./dedupe";
import { scoreOpportunity } from "./score";
import type { PlaceRecord } from "./places/types";
import { DEFAULT_RADII_KM } from "./funnel";
import { classifyWebsite, hasOwnWebsite } from "./website";
import { CATEGORY_GROUPS } from "./categories";
import {
  isTemporaryOverpassError,
  OverpassPlacesProvider,
  splitAreaIntoCells,
} from "./places/overpass";

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

const IMPORT_BATCH_SIZE = 200;
export const MAX_OVERPASS_AUTO_RETRIES = 5;

type ImportProgress = {
  radiusIndex: number;
  cellIndex: number;
  categoryIndex: number;
  successfulSteps: number;
  phase?: string;
  radiusKm?: number;
  cellNumber?: number;
  cellCount?: number;
  categoryId?: string;
  retryCount: number;
  message?: string;
  attribution?: string;
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseProgress(value: string): ImportProgress {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      radiusIndex: 0,
      cellIndex: 0,
      categoryIndex: 0,
      successfulSteps: 0,
      retryCount: 0,
    };
  }
  const raw = parsed as Partial<ImportProgress>;
  const integer = (candidate: unknown) =>
    typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0
      ? candidate
      : 0;
  return {
    radiusIndex: integer(raw.radiusIndex),
    cellIndex: integer(raw.cellIndex),
    categoryIndex: integer(raw.categoryIndex),
    successfulSteps: integer(raw.successfulSteps),
    retryCount: integer(raw.retryCount),
  };
}

export function overpassRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(20_000, 2_000 * 2 ** (safeAttempt - 1));
}

function parseStoredStringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseStoredNumberArray(value: string): number[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item) && item > 0,
      )
    : [];
}

export function normalizeImportRadii(
  requested: readonly number[] | undefined,
  initialRadiusKm: number,
  maxRadiusKm: number,
): number[] {
  const initial = Math.max(1, Math.min(initialRadiusKm, maxRadiusKm));
  const maximum = Math.max(initial, maxRadiusKm);
  const candidates = requested?.length ? requested : DEFAULT_RADII_KM;
  return [
    ...new Set(
      [initial, ...candidates, maximum]
        .filter((radius) => Number.isFinite(radius) && radius >= initial && radius <= maximum)
        .map((radius) => Math.round(radius * 100) / 100),
    ),
  ].sort((a, b) => a - b);
}

function importCategories(value: string): string[] {
  const validIds = new Set(CATEGORY_GROUPS.map((group) => group.id));
  const stored = parseStoredStringArray(value).filter((id) => validIds.has(id));
  return stored.length > 0 ? stored : CATEGORY_GROUPS.map((group) => group.id);
}

function nextProgress(
  current: ImportProgress,
  cellCount: number,
  categoryCount: number,
): ImportProgress {
  let { radiusIndex, cellIndex, categoryIndex } = current;
  categoryIndex += 1;
  if (categoryIndex >= categoryCount) {
    categoryIndex = 0;
    cellIndex += 1;
  }
  if (cellIndex >= cellCount) {
    cellIndex = 0;
    radiusIndex += 1;
  }
  return {
    radiusIndex,
    cellIndex,
    categoryIndex,
    successfulSteps: current.successfulSteps + 1,
    retryCount: 0,
  };
}

function looksLikeFranchise(name: string): boolean {
  const n = name.toLowerCase();
  return FRANCHISE_HINTS.some((h) => n.includes(h));
}

function websiteStatusFor(website?: string | null, socialLinks?: string[]): string {
  const classification = classifyWebsite(website);
  if (classification.hasOwnWebsite) return "unknown";
  if (
    classification.kind === "social" ||
    classification.kind === "directory" ||
    classification.kind === "link_hub" ||
    (socialLinks?.length ?? 0) > 0
  ) {
    return "social_only";
  }
  return "not_reported";
}

function parseSocialLinks(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((link): link is string => typeof link === "string")
      : [];
  } catch {
    return [];
  }
}

async function countEligibleRealLeads(): Promise<number> {
  const businesses = await prisma.business.findMany({
    where: { isDemo: false },
    select: { website: true },
  });
  return businesses.filter((business) => !hasOwnWebsite(business.website)).length;
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
  const currentById = new Map(existing.map((business) => [business.id, business]));

  for (const place of places) {
    if (!place.name?.trim()) {
      stats.rejected += 1;
      continue;
    }

    const phoneE164 = normalizePhoneE164(place.phoneRaw);
    const websiteClassification = classifyWebsite(place.website);
    const scoreSocialLinks = [
      ...(place.socialLinks ?? []),
      ...(websiteClassification.hasOwnWebsite || !websiteClassification.normalizedUrl
        ? []
        : [websiteClassification.normalizedUrl]),
    ];
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
        website: websiteClassification.hasOwnWebsite ? place.website : null,
        websiteStatus: websiteStatusFor(place.website, scoreSocialLinks),
        socialLinks: scoreSocialLinks,
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
      const current = currentById.get(dup.match.id);
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

      // A newly discovered own website must retire an existing lead from the
      // default queue, even when its previous website field held a social page.
      if (websiteClassification.hasOwnWebsite && !hasOwnWebsite(current.website)) {
        merged.website = place.website ?? null;
      }
      const mergedSocialLinks = [...parseSocialLinks(current.socialLinks), ...scoreSocialLinks];
      const mergedWebsiteStatus = websiteStatusFor(
        typeof merged.website === "string" ? merged.website : null,
        mergedSocialLinks,
      );

      const updated = await prisma.business.update({
        where: { id: dup.match.id },
        data: {
          ...merged,
          websiteStatus: mergedWebsiteStatus,
          lastVerifiedAt: new Date(),
          distanceKm: dist ?? undefined,
          opportunityScore: scored.opportunityScore,
          confidenceScore: scored.confidenceScore,
          scoreReasons: JSON.stringify(scored.reasons),
          sources: {
            create: {
              source: place.source,
              externalId: place.externalId,
              fieldName: "merge",
              fieldValue: JSON.stringify({ conflicts, reasons: dup.reason }),
              rawPayload: JSON.stringify(place.raw ?? null),
            },
          },
        },
      });
      currentById.set(updated.id, updated);
      const workingMatch = working.find((business) => business.id === updated.id);
      if (workingMatch) {
        workingMatch.website = updated.website;
        workingMatch.phoneE164 = updated.phoneE164;
        workingMatch.address = updated.address;
      }
      continue;
    }

    if (websiteClassification.hasOwnWebsite) {
      stats.rejected += 1;
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
        websiteStatus: websiteStatusFor(place.website, scoreSocialLinks),
        socialLinks: JSON.stringify(place.socialLinks ?? []),
        sourceUrl: place.sourceUrl,
        opportunityScore: scored.opportunityScore,
        confidenceScore: scored.confidenceScore,
        scoreReasons: JSON.stringify(scored.reasons),
        isDemo,
        funnelStage: "novo",
        scores: {
          create: {
            opportunityScore: scored.opportunityScore,
            confidenceScore: scored.confidenceScore,
            reasonsJson: JSON.stringify(scored.reasons),
            breakdownJson: JSON.stringify(scored.breakdown),
          },
        },
        consents: {
          create: {
            optInStatus: "unknown",
          },
        },
        sources: {
          create: {
            source: place.source,
            externalId: place.externalId,
            fieldName: "record",
            fieldValue: place.name,
            rawPayload: JSON.stringify(place.raw ?? null),
          },
        },
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
    currentById.set(created.id, created);
    stats.accepted += 1;
  }

  return stats;
}

/**
 * Process one small, checkpointed Overpass step. Returning true means the caller
 * should enqueue another invocation; false means the job is done or paused.
 */
export async function runOverpassImportStep(jobId: string): Promise<boolean> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || !["pending", "running"].includes(job.status)) return false;
  if (job.originLat == null || job.originLng == null) {
    await prisma.importJob.updateMany({
      where: { id: jobId, status: { in: ["pending", "running"] } },
      data: {
        status: "failed",
        errorMessage: "A origem da busca não possui latitude/longitude.",
        finishedAt: new Date(),
      },
    });
    return false;
  }

  const acquired = await prisma.importJob.updateMany({
    where: { id: jobId, status: { in: ["pending", "running"] } },
    data: {
      status: "processing",
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
    },
  });
  if (acquired.count !== 1) return false;

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const provider = new OverpassPlacesProvider();
  const goal = settings?.leadGoal ?? 1000;
  const current = parseProgress(job.progressJson);

  try {
    const radii = normalizeImportRadii(
      parseStoredNumberArray(job.radiiKm),
      settings?.initialRadiusKm ?? 5,
      settings?.maxRadiusKm ?? 80,
    );
    const categories = importCategories(job.categories);
    const realCount = await countEligibleRealLeads();

    if (realCount >= goal || current.radiusIndex >= radii.length) {
      await prisma.importJob.updateMany({
        where: { id: jobId, status: "processing" },
        data: {
          status: "completed",
          finishedAt: new Date(),
          progressJson: JSON.stringify({
            ...current,
            phase: "completed",
            message:
              realCount >= goal
                ? `Meta de ${goal} leads sem site próprio atingida.`
                : "Todos os raios foram processados.",
          }),
        },
      });
      return false;
    }

    const radiusKm = radii[current.radiusIndex];
    const cells = splitAreaIntoCells(job.originLat, job.originLng, radiusKm, 12);
    const safeCellIndex = Math.min(current.cellIndex, Math.max(0, cells.length - 1));
    const safeCategoryIndex = Math.min(
      current.categoryIndex,
      Math.max(0, categories.length - 1),
    );
    const cell = cells[safeCellIndex];
    const categoryId = categories[safeCategoryIndex];

    const startedStep = await prisma.importJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: {
        currentRadiusKm: radiusKm,
        progressJson: JSON.stringify({
          ...current,
          cellIndex: safeCellIndex,
          categoryIndex: safeCategoryIndex,
          phase: "querying",
          radiusKm,
          cellNumber: safeCellIndex + 1,
          cellCount: cells.length,
          categoryId,
          message: `Consultando raio ${radiusKm} km, célula ${safeCellIndex + 1}/${cells.length}.`,
        }),
      },
    });
    if (startedStep.count !== 1) return false;

    const result = await provider.search({
      area: {
        lat: cell.lat,
        lng: cell.lng,
        radiusKm: cell.radiusKm,
        label: job.originLabel ?? undefined,
      },
      categoryIds: [categoryId],
    });

    const fresh = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!fresh || fresh.status === "cancelled" || fresh.status === "paused") return false;

    const knownRows = await prisma.business.findMany({
      where: { source: "overpass" },
      select: { externalId: true },
    });
    const known = new Set(knownRows.map((row) => row.externalId).filter(Boolean));
    const prioritized = [...result.places].sort((a, b) => {
      const weight = (place: PlaceRecord) =>
        (known.has(place.externalId) ? 0 : 100) +
        (place.phoneRaw ? 20 : 0) +
        (hasOwnWebsite(place.website) ? 0 : 10);
      return weight(b) - weight(a);
    });
    const remaining = Math.max(1, goal - realCount);
    const places = prioritized.slice(0, Math.min(IMPORT_BATCH_SIZE, remaining + 50));
    const stats = await upsertPlaces(
      places,
      { lat: job.originLat, lng: job.originLng },
      {
        franchisePenalty: settings?.franchisePenalty ?? 15,
        modernSitePenalty: settings?.modernSitePenalty ?? 20,
        staleDataPenalty: settings?.staleDataPenalty ?? 10,
        maxRadiusKm: settings?.maxRadiusKm ?? 80,
      },
      false,
    );

    const after = await countEligibleRealLeads();
    const advanced = nextProgress(
      { ...current, cellIndex: safeCellIndex, categoryIndex: safeCategoryIndex },
      cells.length,
      categories.length,
    );
    const completed = after >= goal || advanced.radiusIndex >= radii.length;

    const checkpoint = await prisma.importJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: {
        status: completed ? "completed" : "running",
        finishedAt: completed ? new Date() : null,
        foundCount: { increment: result.places.length },
        acceptedCount: { increment: stats.accepted },
        duplicateCount: { increment: stats.duplicate },
        rejectedCount: { increment: stats.rejected },
        progressJson: JSON.stringify({
          ...advanced,
          phase: completed ? "completed" : "checkpoint",
          radiusKm,
          cellNumber: safeCellIndex + 1,
          cellCount: cells.length,
          categoryId,
          attribution: result.attribution,
          message: completed
            ? after >= goal
              ? `Meta de ${goal} leads sem site próprio atingida.`
              : "Todos os raios foram processados."
            : `Etapa concluída: ${stats.accepted} novo(s), ${stats.duplicate} duplicado(s).`,
        }),
      },
    });
    return checkpoint.count === 1 && !completed;
  } catch (err) {
    if (isTemporaryOverpassError(err)) {
      const retryCount = current.retryCount + 1;
      if (retryCount <= MAX_OVERPASS_AUTO_RETRIES) {
        const delayMs = overpassRetryDelayMs(retryCount);
        const retryScheduled = await prisma.importJob.updateMany({
          where: { id: jobId, status: "processing" },
          data: {
            status: "running",
            finishedAt: null,
            errorMessage: null,
            progressJson: JSON.stringify({
              ...current,
              retryCount,
              phase: "retrying",
              message: `Servidor de mapas ocupado. Nova tentativa automática ${retryCount}/${MAX_OVERPASS_AUTO_RETRIES} em ${Math.ceil(delayMs / 1000)}s.`,
            }),
          },
        });
        if (retryScheduled.count !== 1) return false;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return true;
      }
    }

    await prisma.importJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: {
        status: "failed",
        errorMessage: isTemporaryOverpassError(err)
          ? "Os servidores de mapas continuaram indisponíveis após as tentativas automáticas. Clique em Continuar para tentar novamente."
          : err instanceof Error
            ? err.message
            : "Erro na importação",
        finishedAt: new Date(),
      },
    });
    return false;
  }
}

/**
 * Process as many checkpoints as safely fit in one Vercel invocation without
 * recursively requesting this deployment. The remaining work stays as
 * `running` and is picked up by the next authenticated progress poll.
 */
export async function runOverpassImportBurst(
  jobId: string,
  budgetMs = 235_000,
): Promise<void> {
  const deadline = Date.now() + Math.max(1_000, budgetMs);
  let shouldContinue = true;

  while (shouldContinue) {
    shouldContinue = await runOverpassImportStep(jobId);
    if (!shouldContinue) return;

    // Reserve enough time for one worst-case request across all fallbacks,
    // database writes and a possible short retry delay.
    if (Date.now() + 120_000 >= deadline) return;
  }
}
