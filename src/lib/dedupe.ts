import { distanceKm } from "./distance";
import { normalizeWebsiteDomain } from "./website";

export type DedupeCandidate = {
  id?: string;
  source: string;
  externalId?: string | null;
  name: string;
  address?: string | null;
  phoneE164?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(ltda|me|eireli|sa|ss|cia|comercio|com)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddress(address?: string | null): string {
  if (!address) return "";
  return address
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(rua|r|avenida|av|travessa|tv|alameda|al)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(website?: string | null): string | null {
  return normalizeWebsiteDomain(website);
}

/** Dice coefficient on character bigrams for name similarity (0–1). */
export function nameSimilarity(a: string, b: string): number {
  const s1 = normalizeName(a);
  const s2 = normalizeName(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };
  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  let intersection = 0;
  for (const [k, v] of b1) {
    intersection += Math.min(v, b2.get(k) ?? 0);
  }
  return (2 * intersection) / (s1.length - 1 + (s2.length - 1) || 1);
}

export type MatchReason =
  | "source_external_id"
  | "phone_e164"
  | "domain"
  | "name_address"
  | "name_geo";

export function findDuplicate(
  candidate: DedupeCandidate,
  existing: DedupeCandidate[],
  opts?: { nameThreshold?: number; maxDistanceKm?: number },
): { match: DedupeCandidate; reason: MatchReason } | null {
  const nameThreshold = opts?.nameThreshold ?? 0.86;
  const maxDistanceKm = opts?.maxDistanceKm ?? 0.15;

  if (candidate.externalId) {
    const byExt = existing.find(
      (e) => e.source === candidate.source && e.externalId === candidate.externalId,
    );
    if (byExt) return { match: byExt, reason: "source_external_id" };
  }

  if (candidate.phoneE164) {
    const byPhone = existing.find((e) => e.phoneE164 && e.phoneE164 === candidate.phoneE164);
    if (byPhone) return { match: byPhone, reason: "phone_e164" };
  }

  const domain = normalizeDomain(candidate.website);
  if (domain) {
    const byDomain = existing.find((e) => normalizeDomain(e.website) === domain);
    if (byDomain) return { match: byDomain, reason: "domain" };
  }

  const candName = normalizeName(candidate.name);
  const candAddr = normalizeAddress(candidate.address);

  for (const e of existing) {
    const sameName = normalizeName(e.name) === candName;
    const sameAddr =
      candAddr.length > 0 && normalizeAddress(e.address) === candAddr && candAddr.length > 5;
    if (sameName && sameAddr) {
      return { match: e, reason: "name_address" };
    }

    const sim = nameSimilarity(candidate.name, e.name);
    if (
      sim >= nameThreshold &&
      candidate.latitude != null &&
      candidate.longitude != null &&
      e.latitude != null &&
      e.longitude != null
    ) {
      const d = distanceKm(candidate.latitude, candidate.longitude, e.latitude, e.longitude);
      if (d <= maxDistanceKm) {
        return { match: e, reason: "name_geo" };
      }
    }
  }

  return null;
}

export type FieldProvenance = {
  field: string;
  value: string;
  source: string;
  collectedAt: string;
};

export function mergePreferringNonEmpty<T extends Record<string, unknown>>(
  current: T,
  incoming: Partial<T>,
  source: string,
): { merged: T; conflicts: FieldProvenance[] } {
  const merged = { ...current };
  const conflicts: FieldProvenance[] = [];
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === "") continue;
    const prev = merged[key as keyof T];
    if (prev == null || prev === "") {
      (merged as Record<string, unknown>)[key] = value;
    } else if (String(prev) !== String(value)) {
      conflicts.push({
        field: key,
        value: String(value),
        source,
        collectedAt: now,
      });
    }
  }

  return { merged, conflicts };
}
