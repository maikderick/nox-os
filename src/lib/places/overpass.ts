import { CATEGORY_GROUPS, categoryLabelFromOsm } from "../categories";
import { fetchWithRetry } from "./http";
import type { PlaceRecord, PlacesProvider, PlacesSearchParams, PlacesSearchResult } from "./types";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function buildQuery(lat: number, lng: number, radiusM: number, categoryIds: string[]): string {
  const groups =
    categoryIds.length > 0
      ? CATEGORY_GROUPS.filter((g) => categoryIds.includes(g.id))
      : CATEGORY_GROUPS.filter((g) => g.id !== "catalog");

  const selectors = groups.flatMap((g) => g.osmTags);
  const unique = [...new Set(selectors)];
  const around = unique.map((sel) => `${sel}(around:${radiusM},${lat},${lng});`).join("\n");

  return `
[out:json][timeout:60];
(
${around}
);
out center tags;
`.trim();
}

function elementToPlace(el: {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}): PlaceRecord | null {
  const tags = el.tags ?? {};
  const name = tags.name || tags["name:pt"] || tags.brand;
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const social: string[] = [];
  if (tags["contact:facebook"]) social.push(tags["contact:facebook"]);
  if (tags["contact:instagram"]) social.push(tags["contact:instagram"]);

  const website =
    tags.website || tags["contact:website"] || tags.url || undefined;

  const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"];

  const addressParts = [
    tags["addr:street"],
    tags["addr:housenumber"],
  ].filter(Boolean);

  return {
    externalId: `${el.type}/${el.id}`,
    source: "overpass",
    name,
    category: categoryLabelFromOsm(tags),
    address: addressParts.join(", ") || tags["addr:full"],
    neighborhood: tags["addr:suburb"] || tags["addr:neighbourhood"],
    city: tags["addr:city"],
    state: tags["addr:state"],
    postalCode: tags["addr:postcode"],
    latitude: lat,
    longitude: lon,
    phoneRaw: phone,
    website,
    socialLinks: social,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    raw: el,
  };
}

/**
 * Split large radii into a grid of smaller circles when needed.
 */
export function splitAreaIntoCells(
  lat: number,
  lng: number,
  radiusKm: number,
  cellKm = 10,
): Array<{ lat: number; lng: number; radiusKm: number }> {
  if (radiusKm <= cellKm) {
    return [{ lat, lng, radiusKm }];
  }
  const cells: Array<{ lat: number; lng: number; radiusKm: number }> = [];
  const stepDeg = cellKm / 111;
  const steps = Math.ceil(radiusKm / cellKm);
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const cLat = lat + i * stepDeg;
      const cLng = lng + (j * stepDeg) / Math.cos((lat * Math.PI) / 180);
      const distApprox = Math.sqrt((i * cellKm) ** 2 + (j * cellKm) ** 2);
      if (distApprox <= radiusKm + cellKm * 0.5) {
        cells.push({ lat: cLat, lng: cLng, radiusKm: cellKm });
      }
    }
  }
  return cells;
}

export class OverpassPlacesProvider implements PlacesProvider {
  readonly id = "overpass";
  readonly name = "OpenStreetMap / Overpass";
  readonly attribution =
    "© OpenStreetMap contributors — dados sob ODbL (https://www.openstreetmap.org/copyright)";

  async search(params: PlacesSearchParams): Promise<PlacesSearchResult> {
    const { area, categoryIds, signal, onProgress } = params;
    const cells = splitAreaIntoCells(area.lat, area.lng, area.radiusKm, 12);
    const byId = new Map<string, PlaceRecord>();
    let truncated = false;

    for (let i = 0; i < cells.length; i++) {
      if (signal?.aborted) break;
      const cell = cells[i];
      onProgress?.(`Overpass célula ${i + 1}/${cells.length} (r=${cell.radiusKm}km)`);
      const query = buildQuery(cell.lat, cell.lng, Math.round(cell.radiusKm * 1000), categoryIds);

      let lastErr: unknown;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const res = await fetchWithRetry(
            endpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `data=${encodeURIComponent(query)}`,
            },
            { signal, retries: 3, timeoutMs: 60000 },
          );
          if (!res.ok) {
            lastErr = new Error(`Overpass HTTP ${res.status}`);
            continue;
          }
          const json = (await res.json()) as {
            elements?: Array<{
              type: string;
              id: number;
              lat?: number;
              lon?: number;
              center?: { lat: number; lon: number };
              tags?: Record<string, string>;
            }>;
            remark?: string;
          };
          for (const el of json.elements ?? []) {
            const place = elementToPlace(el);
            if (place) byId.set(place.externalId, place);
          }
          if (json.remark?.toLowerCase().includes("runtime error")) truncated = true;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) {
        onProgress?.(
          `Falha em célula ${i + 1}: ${lastErr instanceof Error ? lastErr.message : "erro"}`,
        );
      }
      // polite pacing between cells
      await new Promise((r) => setTimeout(r, 1200));
    }

    return {
      places: [...byId.values()],
      attribution: this.attribution,
      truncated,
    };
  }
}
