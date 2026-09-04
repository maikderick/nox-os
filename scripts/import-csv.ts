/**
 * CLI import helper: npx tsx scripts/import-csv.ts path/to/file.csv
 */
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { parseCsvPlaces } from "../src/lib/places/csv";
import { upsertPlaces } from "../src/lib/import-service";

const prisma = new PrismaClient();

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/import-csv.ts <file.csv>");
    process.exit(1);
  }
  const csvText = fs.readFileSync(file, "utf8");
  const places = parseCsvPlaces(csvText);
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const origin =
    settings?.originLat != null && settings.originLng != null
      ? { lat: settings.originLat, lng: settings.originLng }
      : null;
  const stats = await upsertPlaces(places, origin, {
    franchisePenalty: settings?.franchisePenalty ?? 15,
    modernSitePenalty: settings?.modernSitePenalty ?? 20,
    staleDataPenalty: settings?.staleDataPenalty ?? 10,
    maxRadiusKm: settings?.maxRadiusKm ?? 80,
  });
  console.log(stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
