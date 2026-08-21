import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertPlaces } from "../../src/lib/import-service";
import type { PlaceRecord } from "../../src/lib/places/types";

const prisma = new PrismaClient();

describe("import idempotent + pagination perf", () => {
  beforeAll(async () => {
    await prisma.business.deleteMany({ where: { source: "test" } });
  });

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { source: "test" } });
    await prisma.$disconnect();
  });

  it("does not duplicate same import", async () => {
    const places: PlaceRecord[] = [
      {
        externalId: "t/1",
        source: "test",
        name: "Empresa Teste Idempotente",
        category: "Serviços",
        city: "Testópolis",
        phoneRaw: "11988887777",
        latitude: -23.55,
        longitude: -46.63,
      },
    ];

    const settings = {
      franchisePenalty: 15,
      modernSitePenalty: 20,
      staleDataPenalty: 10,
      maxRadiusKm: 80,
    };

    const first = await upsertPlaces(places, { lat: -23.55, lng: -46.63 }, settings);
    const second = await upsertPlaces(places, { lat: -23.55, lng: -46.63 }, settings);

    expect(first.accepted).toBe(1);
    expect(second.duplicate).toBe(1);
    expect(second.accepted).toBe(0);

    const count = await prisma.business.count({
      where: { source: "test", externalId: "t/1" },
    });
    expect(count).toBe(1);
  });

  it("filters/paginates quickly with many records", async () => {
    const batch: PlaceRecord[] = [];
    for (let i = 0; i < 200; i++) {
      batch.push({
        externalId: `perf/${i}`,
        source: "test",
        name: `Perf Business ${i}`,
        category: i % 2 === 0 ? "Restaurantes" : "Clínicas",
        city: i % 3 === 0 ? "São Paulo" : "Campinas",
        latitude: -23.55 + i * 0.001,
        longitude: -46.63 + i * 0.001,
        phoneRaw: i % 5 === 0 ? `1199${String(i).padStart(6, "0")}` : undefined,
      });
    }
    await upsertPlaces(batch, { lat: -23.55, lng: -46.63 }, {
      franchisePenalty: 15,
      modernSitePenalty: 20,
      staleDataPenalty: 10,
      maxRadiusKm: 80,
    });

    const start = performance.now();
    const page = await prisma.business.findMany({
      where: { source: "test", category: { contains: "Restaurantes" } },
      orderBy: { opportunityScore: "desc" },
      skip: 0,
      take: 25,
    });
    const elapsed = performance.now() - start;
    expect(page.length).toBeLessThanOrEqual(25);
    expect(elapsed).toBeLessThan(2000);
  }, 60000);
});
