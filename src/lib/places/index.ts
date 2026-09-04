import { CsvPlacesProvider, LicensedCommercialProvider } from "./csv";
import { OverpassPlacesProvider } from "./overpass";
import type { PlacesProvider } from "./types";

export * from "./types";
export * from "./overpass";
export * from "./csv";
export * from "./http";

export function getPlacesProvider(id: string, csvText?: string): PlacesProvider {
  switch (id) {
    case "overpass":
      return new OverpassPlacesProvider();
    case "csv":
      if (!csvText) throw new Error("CSV text required");
      return new CsvPlacesProvider(csvText);
    case "licensed_commercial":
      return new LicensedCommercialProvider();
    default:
      throw new Error(`Unknown PlacesProvider: ${id}`);
  }
}
