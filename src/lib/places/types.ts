export type PlaceRecord = {
  externalId: string;
  source: string;
  name: string;
  category: string;
  address?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  phoneRaw?: string;
  website?: string;
  socialLinks?: string[];
  sourceUrl?: string;
  raw?: unknown;
};

export type SearchArea = {
  lat: number;
  lng: number;
  radiusKm: number;
  label?: string;
};

export type PlacesSearchParams = {
  area: SearchArea;
  categoryIds: string[];
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
};

export type PlacesSearchResult = {
  places: PlaceRecord[];
  attribution: string;
  truncated: boolean;
};

/**
 * Swap data origins without changing the rest of the app.
 * MVP: Overpass + CSV. Commercial licensed provider can implement this later.
 */
export interface PlacesProvider {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  search(params: PlacesSearchParams): Promise<PlacesSearchResult>;
}
