import { CATEGORY_GROUPS, categoryLabelFromOsm } from "../categories";
import { fetchWithRetry } from "./http";
import type { PlaceRecord, PlacesProvider, PlacesSearchParams, PlacesSearchResult } from "./types";

/**
 * Public global instances currently listed by the OpenStreetMap community.
 * Kumi moved to private.coffee, so keeping the old hostname here made the
 * fallback ineffective when the main instance was overloaded.
 */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

const OVERPASS_REQUEST_TIMEOUT_MS = 35_000;

export class OverpassTemporaryError extends Error {
  readonly code = "OVERPASS_TEMPORARY_UNAVAILABLE";

  constructor(message = "Os servidores Overpass estão temporariamente indisponíveis.") {
    super(message);
    this.name = "OverpassTemporaryError";
  }
}

export function isTemporaryOverpassError(error: unknown): boolean {
  if (error instanceof OverpassTemporaryError) return true;
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "OVERPASS_TEMPORARY_UNAVAILABLE";
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildQuery(lat: number, lng: number, radiusM: number, categoryIds: string[]): string {
  const groups =
    categoryIds.length > 0
      ? CATEGORY_GROUPS.filter((g) => categoryIds.includes(g.id))
      : CATEGORY_GROUPS.filter((g) => g.id !== "catalog");

  const selectors = groups.flatMap((g) => g.osmTags);
  const unique = [...new Set(selectors)];
  const around = unique.map((sel) => `${sel}(around:${radiusM},${lat},${lng});`).join("\n");

  return `
[out:json][timeout:25];
(
${around}
);
out center tags qt;
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
    let successfulCells = 0;
    let lastFailure: unknown;

    for (let i = 0; i < cells.length; i++) {
      if (signal?.aborted) break;
      const cell = cells[i];
      onProgress?.(`Overpass célula ${i + 1}/${cells.length} (r=${cell.radiusKm}km)`);
      const query = buildQuery(cell.lat, cell.lng, Math.round(cell.radiusKm * 1000), categoryIds);

      let lastErr: unknown;
      const failureStatuses: number[] = [];
      let connectionFailures = 0;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const res = await fetchWithRetry(
            endpoint,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Referer: "https://nox-os-pi.vercel.app/",
                "User-Agent": "NOX-OS-Leads/1.0 (+https://nox-os-pi.vercel.app/privacy)",
              },
              body: `data=${encodeURIComponent(query)}`,
            },
            // Fail over to an independent instance instead of repeatedly
            // waiting on the same overloaded server inside one invocation.
            { signal, retries: 0, timeoutMs: OVERPASS_REQUEST_TIMEOUT_MS },
          );
          if (!res.ok) {
            failureStatuses.push(res.status);
            const httpError = new Error(`Overpass HTTP ${res.status}`);
            lastErr = httpError;
            // A 4xx may be specific to one instance (for example, a proxy/WAF
            // returning 406). Always try the remaining independent servers.
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
          successfulCells += 1;
          lastErr = null;
          break;
        } catch (err) {
          connectionFailures += 1;
          lastErr = err;
        }
      }
      if (lastErr) {
        const statuses = [...new Set(failureStatuses)].join("/");
        const hasTemporaryFailure =
          connectionFailures > 0 || failureStatuses.some(isTemporaryStatus);
        lastFailure = hasTemporaryFailure
          ? new OverpassTemporaryError(
              statuses
                ? `Servidores Overpass temporariamente indisponíveis (HTTP ${statuses}).`
                : "Falha temporária de conexão com os servidores Overpass.",
            )
          : new Error(
              statuses
                ? `A consulta foi rejeitada pelos servidores Overpass (HTTP ${statuses}).`
                : lastErr instanceof Error
                  ? lastErr.message
                  : "A consulta Overpass foi rejeitada.",
            );
        onProgress?.(
          `Falha em célula ${i + 1}: ${
            lastFailure instanceof Error ? lastFailure.message : "erro"
          }`,
        );
      }
      // polite pacing between cells
      if (i < cells.length - 1) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    if (successfulCells === 0) {
      throw lastFailure instanceof Error
        ? lastFailure
        : new Error("Nenhuma consulta Overpass foi concluída.");
    }

    return {
      places: [...byId.values()],
      attribution: this.attribution,
      truncated,
    };
  }
}
