/**
 * Performance harness for 1k / 10k records (run: npm run test:perf).
 * Uses the configured PostgreSQL database — does not invent production leads.
 */
import { PrismaClient } from "@prisma/client";
import { normalizeName } from "../src/lib/dedupe";

const prisma = new PrismaClient();
const N = Number(process.env.PERF_N ?? 1000);

async function main() {
  console.log(`Seeding ${N} synthetic perf rows (source=perf)…`);
  const chunk = 500;
  for (let start = 0; start < N; start += chunk) {
    const data = [];
    for (let i = start; i < Math.min(N, start + chunk); i++) {
      data.push({
        source: "perf",
        externalId: `perf-${i}`,
        name: `Perf Lead ${i}`,
        nameNormalized: normalizeName(`Perf Lead ${i}`),
        category: i % 2 === 0 ? "Restaurantes" : "Clínicas",
        city: i % 3 === 0 ? "São Paulo" : "Campinas",
        latitude: -23.5 + (i % 100) * 0.01,
        longitude: -46.6 + (i % 100) * 0.01,
        opportunityScore: i % 100,
        confidenceScore: 50,
        scoreReasons: "[]",
        isDemo: true,
      });
    }
    await prisma.business.createMany({ data });
  }

  const t0 = performance.now();
  const page = await prisma.business.findMany({
    where: { source: "perf", opportunityScore: { gte: 70 } },
    orderBy: [{ opportunityScore: "desc" }, { name: "asc" }],
    skip: 0,
    take: 50,
  });
  const t1 = performance.now();
  console.log(`Query returned ${page.length} in ${(t1 - t0).toFixed(1)}ms`);

  const count = await prisma.business.count({ where: { source: "perf" } });
  console.log(`Total perf rows: ${count}`);
  await prisma.business.deleteMany({ where: { source: "perf" } });
  console.log("Cleaned perf rows.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
