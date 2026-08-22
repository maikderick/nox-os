import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { normalizeName } from "../src/lib/dedupe";
import { scoreOpportunity } from "../src/lib/score";
import { normalizePhoneE164 } from "../src/lib/phone";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error(
      "Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo de 12 caracteres) antes de executar o seed.",
    );
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: process.env.SELLER_NAME ?? "Admin NOX OS",
      passwordHash,
      role: "admin",
    },
    update: { passwordHash },
  });

  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      brandName: "NOX OS",
      sellerName: process.env.SELLER_NAME ?? "[SEU NOME]",
      defaultCity: process.env.DEFAULT_CITY ?? "[SUA CIDADE/UF]",
      leadGoal: 1000,
      initialRadiusKm: 5,
      maxRadiusKm: 80,
      privacyEmail: process.env.PRIVACY_EMAIL ?? "[SEU E-MAIL]",
      portfolioUrl: process.env.PORTFOLIO_URL ?? "[URL DO PORTFÓLIO]",
      whatsappPhone: process.env.NOX_WHATSAPP ?? "[SEU WHATSAPP]",
      originLat: -23.5505,
      originLng: -46.6333,
      originLabel: "São Paulo, SP (seed)",
    },
    update: {},
  });

  if (process.env.DEMO_MODE === "true") {
    const demos = [
      {
        name: "Padaria Demo Centro",
        category: "Padarias",
        city: "São Paulo",
        state: "SP",
        phone: "11987654321",
        lat: -23.5489,
        lng: -46.6388,
      },
      {
        name: "Barbearia Demo Norte",
        category: "Barbearias e salões",
        city: "São Paulo",
        state: "SP",
        phone: "11912345678",
        lat: -23.51,
        lng: -46.62,
        website: "https://instagram.com/demo",
      },
      {
        name: "Clínica Demo Sul",
        category: "Clínicas",
        city: "São Paulo",
        state: "SP",
        phone: null,
        lat: -23.6,
        lng: -46.65,
      },
    ];

    for (const [i, d] of demos.entries()) {
      const phoneE164 = normalizePhoneE164(d.phone);
      const scored = scoreOpportunity({
        website: d.website,
        websiteStatus: d.website ? "social_only" : "not_reported",
        socialLinks: d.website ? [d.website] : [],
        category: d.category,
        phoneE164,
        distanceKm: 3 + i,
        isActiveHint: true,
        dataFreshDays: 1,
      });

      const created = await prisma.business.upsert({
        where: { source_externalId: { source: "demo", externalId: `demo-${i + 1}` } },
        create: {
          source: "demo",
          externalId: `demo-${i + 1}`,
          name: d.name,
          nameNormalized: normalizeName(d.name),
          category: d.category,
          city: d.city,
          state: d.state,
          latitude: d.lat,
          longitude: d.lng,
          distanceKm: 3 + i,
          phoneRaw: d.phone,
          phoneE164,
          website: d.website,
          websiteStatus: d.website ? "social_only" : "not_reported",
          opportunityScore: scored.opportunityScore,
          confidenceScore: scored.confidenceScore,
          scoreReasons: JSON.stringify(scored.reasons),
          isDemo: true,
          sourceUrl: "https://example.com/demo",
        },
        update: {
          opportunityScore: scored.opportunityScore,
          confidenceScore: scored.confidenceScore,
          scoreReasons: JSON.stringify(scored.reasons),
        },
      });

      await prisma.consentRecord.deleteMany({ where: { businessId: created.id } });
      await prisma.consentRecord.create({
        data: {
          businessId: created.id,
          optInStatus: i === 0 ? "verified" : "unknown",
          source: i === 0 ? "seed demo" : null,
          purpose: i === 0 ? "contato comercial sobre site personalizado NOX OS" : null,
          evidence: i === 0 ? "Consentimento fictício apenas para DEMO_MODE" : null,
          optedInAt: i === 0 ? new Date() : null,
        },
      });
    }
    console.log("Seed demo criado (DEMO_MODE=true). Dados de demonstração.");
  } else {
    console.log("Seed sem dados demo (DEMO_MODE!=true).");
  }

  console.log(`Admin configurado: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
