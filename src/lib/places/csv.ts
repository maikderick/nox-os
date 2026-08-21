import Papa from "papaparse";
import type { PlaceRecord, PlacesProvider, PlacesSearchParams, PlacesSearchResult } from "./types";

export type CsvRow = Record<string, string>;

function pick(row: CsvRow, keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.entries(row).find(
      ([rk]) => rk.trim().toLowerCase() === k.toLowerCase(),
    );
    if (found?.[1]?.trim()) return found[1].trim();
  }
  return undefined;
}

export function parseCsvPlaces(csvText: string, source = "csv"): PlaceRecord[] {
  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const places: PlaceRecord[] = [];
  parsed.data.forEach((row, index) => {
    const name = pick(row, ["name", "nome"]);
    if (!name) return;

    const latRaw = pick(row, ["latitude", "lat"]);
    const lngRaw = pick(row, ["longitude", "lng", "lon"]);
    const externalId =
      pick(row, ["externalId", "external_id", "id"]) ?? `csv-${index + 1}-${name}`;

    places.push({
      externalId,
      source,
      name,
      category: pick(row, ["category", "categoria"]) ?? "Importado CSV",
      address: pick(row, ["address", "endereco", "endereço"]),
      neighborhood: pick(row, ["neighborhood", "bairro"]),
      city: pick(row, ["city", "cidade"]),
      state: pick(row, ["state", "uf", "estado"]),
      postalCode: pick(row, ["postalCode", "cep"]),
      latitude: latRaw ? Number(latRaw) : undefined,
      longitude: lngRaw ? Number(lngRaw) : undefined,
      phoneRaw: pick(row, ["phone", "telefone"]),
      website: pick(row, ["website", "site"]),
      socialLinks: [],
      sourceUrl: pick(row, ["sourceUrl", "fonte"]),
      raw: row,
    });
  });

  return places;
}

export class CsvPlacesProvider implements PlacesProvider {
  readonly id = "csv";
  readonly name = "Importação CSV";
  readonly attribution = "Dados importados pelo usuário (CSV).";

  constructor(private readonly csvText: string) {}

  async search(params: PlacesSearchParams): Promise<PlacesSearchResult> {
    void params;
    const places = parseCsvPlaces(this.csvText);
    return { places, attribution: this.attribution, truncated: false };
  }
}

/**
 * Stub for a future commercially licensed places API.
 * Documented contract only — does not invent businesses.
 */
export class LicensedCommercialProvider implements PlacesProvider {
  readonly id = "licensed_commercial";
  readonly name = "Provedor comercial licenciado (stub)";
  readonly attribution = "Configure API_KEY do provedor licenciado no backend.";

  async search(): Promise<PlacesSearchResult> {
    throw new Error(
      "Provedor comercial não configurado. Defina LICENSED_PLACES_API_URL e LICENSED_PLACES_API_KEY no servidor.",
    );
  }
}
