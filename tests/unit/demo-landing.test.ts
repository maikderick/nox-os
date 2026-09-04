import { describe, expect, it } from "vitest";
import {
  createDemoSlug,
  createDemoBusinessSnapshot,
  demoExpiryDate,
  ensureDemoBusinessSnapshot,
  generateDemoLandingContent,
  hasDemoBusinessSnapshot,
  isDemoLandingExpired,
  preserveDemoBusinessSnapshot,
} from "../../src/lib/demo-landing";
import {
  demoLandingContentSchema,
  isSafeDemoImageUrl,
  normalizeDemoCtaLabel,
  parseDemoLandingContent,
  updateDemoLandingSchema,
} from "../../src/lib/demo-landing-schema";

const lead = {
  name: "Restaurante Dom Pedro",
  category: "Restaurantes",
  address: "Rua Central, 10",
  neighborhood: "Centro",
  city: "Fortaleza",
  state: "CE",
  postalCode: "60000-000",
  phoneE164: "+5585999999999",
  socialLinks: JSON.stringify([
    "https://instagram.com/restaurante-dom-pedro",
    "http://facebook.com/restaurante-dom-pedro",
    "https://usuario:senha@tiktok.com/@dompedro",
  ]),
  website: "https://threads.net/@restaurante-dom-pedro",
  latitude: -3.7319,
  longitude: -38.5267,
};

describe("automatic demo landing generator", () => {
  it("uses confirmed lead fields and leaves services empty", () => {
    const content = generateDemoLandingContent(lead);

    expect(content.headline).toContain(lead.name);
    expect(content.subheadline).toContain(lead.category);
    expect(content.subheadline).toContain(lead.city);
    expect(content.benefits).toContain(`Bairro: ${lead.neighborhood}`);
    expect(content.services).toEqual([]);
    expect(content.aboutTitle).toBe(`Sobre ${lead.name}`);
    expect(content.factsTitle).toBe("Informações essenciais");
    expect(content.servicesTitle).toBe("Serviços");
    expect(content.servicesIntro).toContain(lead.category);
    expect(content.processSteps).toHaveLength(3);
    expect(content.processSteps.join(" ")).toContain(lead.category);
    expect(content.processSteps.join(" ")).toContain(`${lead.city} — ${lead.state}`);
    expect(content.faqs).toHaveLength(4);
    expect(content.faqs.some((item) => item.answer.includes(lead.city))).toBe(true);
    expect(content.finalCtaTitle).toContain(lead.name);
    expect(content.heroImageUrl).toBe("");
    expect(content.galleryTitle).toContain(lead.name);
    expect(content.galleryIntro).toContain(lead.category);
    expect(content.galleryIntro).toContain(lead.city);
    expect(content.galleryImages).toEqual([]);
    expect(content.contactTitle).toContain(lead.name);
    expect(content.contactText).toContain(lead.city);
    expect(content.contactText).toContain("valide os canais informados");
    expect(content.businessSnapshot).toMatchObject({
      name: lead.name,
      category: lead.category,
      address: lead.address,
      neighborhood: lead.neighborhood,
      city: lead.city,
      state: lead.state,
      postalCode: lead.postalCode,
      phoneE164: lead.phoneE164,
      latitude: lead.latitude,
      longitude: lead.longitude,
    });
    expect(content.businessSnapshot?.socialLinks).toEqual([
      "https://instagram.com/restaurante-dom-pedro",
      "https://threads.net/@restaurante-dom-pedro",
    ]);
    expect(JSON.stringify({ ...content, businessSnapshot: undefined })).not.toContain(
      lead.phoneE164,
    );
    expect(demoLandingContentSchema.safeParse(content).success).toBe(true);
  });

  it("does not manufacture ratings, prices, hours or services", () => {
    const content = generateDemoLandingContent({
      name: "Clínica Exemplo",
      category: "Clínicas",
      city: "Recife",
    });
    const generatedText = JSON.stringify(content).toLowerCase();

    expect(content.services).toEqual([]);
    expect(content.faqs.some((item) => item.answer.includes("Recife"))).toBe(true);
    expect(generatedText).not.toMatch(/avaliaç|estrela|r\$|preço|horário|segunda a sexta/);
    expect(generatedText).not.toContain("fortaleza");
  });

  it("drops invalid contact facts instead of manufacturing replacements", () => {
    const content = generateDemoLandingContent({
      name: "Clínica Exemplo",
      category: "Clínicas",
      phoneE164: "+55123",
      latitude: 91,
      longitude: -38.5,
      socialLinks: [
        "http://instagram.com/clinica",
        "https://usuario:senha@facebook.com/clinica",
        "https://linkedin.com/company/clinica",
      ],
      website: "https://clinica.example.com",
    });

    expect(content.businessSnapshot?.phoneE164).toBeNull();
    expect(content.businessSnapshot?.latitude).toBeNull();
    expect(content.businessSnapshot?.longitude).toBeNull();
    expect(content.businessSnapshot?.socialLinks).toEqual([
      "https://linkedin.com/company/clinica",
    ]);
  });

  it("selects a deterministic visual preset from the category", () => {
    const restaurant = generateDemoLandingContent(lead);
    const automotive = generateDemoLandingContent({
      ...lead,
      category: "Oficina automotiva",
    });

    expect(restaurant.primaryColor).toBe("#dc2626");
    expect(automotive.primaryColor).toBe("#334155");
    expect(restaurant).toEqual(generateDemoLandingContent(lead));
  });

  it("keeps malformed or oversized provider fields inside the public schema", () => {
    const content = generateDemoLandingContent({
      name: "  ",
      category: "x".repeat(2_000),
      city: "y".repeat(2_000),
    });

    expect(content.headline).toBe("Conheça Negócio local");
    expect(demoLandingContentSchema.safeParse(content).success).toBe(true);
  });
});

describe("demo slug and expiry", () => {
  it("builds an opaque slug with a sanitized business prefix", () => {
    expect(createDemoSlug("Clínica São João!", "abcdef0123456789")).toBe(
      "clinica-sao-joao-abcdef0123456789",
    );
  });

  it("uses fresh strong entropy by default", () => {
    const first = createDemoSlug("Empresa");
    const second = createDemoSlug("Empresa");
    expect(first).toMatch(/^empresa-[a-f0-9]{24}$/);
    expect(second).not.toBe(first);
  });

  it("calculates and detects the validity window", () => {
    const start = new Date("2026-08-21T12:00:00.000Z");
    const expiry = demoExpiryDate(14, start);
    expect(expiry.toISOString()).toBe("2026-09-04T12:00:00.000Z");
    expect(isDemoLandingExpired(expiry, new Date("2026-09-04T11:59:59.999Z"))).toBe(false);
    expect(isDemoLandingExpired(expiry, new Date("2026-09-04T12:00:00.000Z"))).toBe(true);
  });
});

describe("demo content validation", () => {
  it("fills new sections when reading legacy stored content", () => {
    const legacyContent = {
      headline: "Conheça Empresa Legada",
      subheadline: "Serviços locais em Fortaleza.",
      about: "Conteúdo armazenado antes da ampliação do modelo.",
      benefits: ["Categoria cadastrada: Serviços locais"],
      services: [],
      ctaLabel: "Ver informações",
      primaryColor: "#6d28d9",
      accentColor: "#06b6d4",
    };

    const parsed = parseDemoLandingContent(JSON.stringify(legacyContent));

    expect(parsed.aboutTitle).toBe("Sobre");
    expect(parsed.factsTitle).toBe("Informações essenciais");
    expect(parsed.servicesTitle).toBe("Serviços");
    expect(parsed.servicesIntro).toContain("confirmar os detalhes");
    expect(parsed.processSteps).toHaveLength(3);
    expect(parsed.faqTitle).toBe("Dúvidas frequentes");
    expect(parsed.faqs).toHaveLength(2);
    expect(parsed.faqs[0]?.answer).toContain("Consulte diretamente");
    expect(parsed.faqs[1]?.answer).toContain("demonstração não oficial");
    expect(parsed.finalCtaTitle).toBe("Próximo passo");
    expect(parsed.heroImageUrl).toBe("");
    expect(parsed.galleryTitle).toBe("Uma presença digital mais completa");
    expect(parsed.galleryIntro).toContain("fotos oficiais ou autorizadas");
    expect(parsed.galleryIntro).toContain("composições visuais");
    expect(parsed.galleryImages).toEqual([]);
    expect(parsed.contactTitle).toBe("Informações de contato");
    expect(parsed.contactText).toContain("Valide os canais informados diretamente");
    expect(parsed.businessSnapshot).toBeNull();
  });

  it("captures a legacy snapshot once and preserves it across content edits", () => {
    const generated = generateDemoLandingContent(lead);
    const legacyJson = JSON.stringify({ ...generated, businessSnapshot: undefined });

    expect(hasDemoBusinessSnapshot(legacyJson)).toBe(false);
    const firstCapture = ensureDemoBusinessSnapshot(legacyJson, lead);
    expect(firstCapture.captured).toBe(true);
    expect(firstCapture.content.businessSnapshot?.name).toBe(lead.name);
    expect(hasDemoBusinessSnapshot(firstCapture.contentJson)).toBe(true);

    const changedBusiness = {
      ...lead,
      name: "Nome alterado depois",
      category: "Outra categoria",
      phoneE164: "+5585988888888",
    };
    const secondCapture = ensureDemoBusinessSnapshot(firstCapture.contentJson, changedBusiness);
    expect(secondCapture.captured).toBe(false);
    expect(secondCapture.content.businessSnapshot).toEqual(
      firstCapture.content.businessSnapshot,
    );

    const requestedContent = demoLandingContentSchema.parse({
      ...generated,
      headline: "Título editado",
      businessSnapshot: createDemoBusinessSnapshot(changedBusiness),
    });
    const preserved = preserveDemoBusinessSnapshot({
      currentContentJson: firstCapture.contentJson,
      requestedContent,
      business: changedBusiness,
    });

    expect(preserved.content.headline).toBe("Título editado");
    expect(preserved.content.businessSnapshot).toEqual(firstCapture.content.businessSnapshot);
  });

  it("validates every factual snapshot field", () => {
    const content = generateDemoLandingContent(lead);
    const snapshot = content.businessSnapshot!;

    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        businessSnapshot: { ...snapshot, phoneE164: "+55123" },
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        businessSnapshot: { ...snapshot, socialLinks: ["http://instagram.com/empresa"] },
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        businessSnapshot: { ...snapshot, latitude: 91 },
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        businessSnapshot: { ...snapshot, longitude: null },
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        businessSnapshot: { ...snapshot, sourceUrl: "https://example.com" },
      }).success,
    ).toBe(false);
  });

  it("accepts only HTTPS image URLs", () => {
    const content = generateDemoLandingContent(lead);
    const validImage = {
      url: "https://images.example.com/estabelecimento/fachada.webp",
      alt: "Fachada oficial do estabelecimento",
    };

    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: validImage.url,
        galleryImages: [validImage],
      }).success,
    ).toBe(true);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: "http://images.example.com/fachada.webp",
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: "data:image/png;base64,AAAA",
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: "https:images.example.com/fachada.webp",
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: "https://usuario:senha@images.example.com/fachada.webp",
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        galleryImages: [{ ...validImage, url: "http://images.example.com/fachada.webp" }],
      }).success,
    ).toBe(false);

    expect(isSafeDemoImageUrl(validImage.url)).toBe(true);
    expect(isSafeDemoImageUrl("https:images.example.com/fachada.webp")).toBe(false);
    expect(isSafeDemoImageUrl("https://usuario:senha@images.example.com/fachada.webp")).toBe(
      false,
    );
  });

  it("rejects invalid colors and extra content fields", () => {
    const content = generateDemoLandingContent(lead);
    expect(
      demoLandingContentSchema.safeParse({ ...content, primaryColor: "red" }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({ ...content, reviews: ["5 estrelas"] }).success,
    ).toBe(false);
  });

  it("enforces process and FAQ collection limits", () => {
    const content = generateDemoLandingContent(lead);
    expect(
      demoLandingContentSchema.safeParse({ ...content, processSteps: ["Um", "Dois"] }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        processSteps: ["Um", "Dois", "Três", "Quatro", "Cinco"],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        faqs: Array.from({ length: 7 }, (_, index) => ({
          question: `Pergunta ${index + 1}`,
          answer: "Resposta confirmada.",
        })),
      }).success,
    ).toBe(false);
  });

  it("enforces the editing limits shared with the landing UI", () => {
    const content = generateDemoLandingContent(lead);

    for (const field of [
      "aboutTitle",
      "factsTitle",
      "servicesTitle",
      "processTitle",
      "faqTitle",
      "finalCtaTitle",
      "galleryTitle",
      "contactTitle",
    ] as const) {
      expect(
        demoLandingContentSchema.safeParse({ ...content, [field]: "x".repeat(121) }).success,
      ).toBe(false);
    }

    for (const field of [
      "servicesIntro",
      "processIntro",
      "finalCtaText",
      "galleryIntro",
      "contactText",
    ] as const) {
      expect(
        demoLandingContentSchema.safeParse({ ...content, [field]: "x".repeat(601) }).success,
      ).toBe(false);
    }

    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        processSteps: ["x".repeat(181), "Etapa dois", "Etapa três"],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        faqs: [{ question: "x".repeat(181), answer: "Resposta" }],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        faqs: [{ question: "Pergunta", answer: "x".repeat(601) }],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        heroImageUrl: `https://images.example.com/${"x".repeat(2_000)}`,
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        galleryImages: Array.from({ length: 7 }, (_, index) => ({
          url: `https://images.example.com/foto-${index + 1}.webp`,
          alt: `Foto ${index + 1}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        galleryImages: [
          {
            url: `https://images.example.com/${"x".repeat(2_000)}`,
            alt: "Foto oficial",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...content,
        galleryImages: [
          {
            url: "https://images.example.com/foto.webp",
            alt: "x".repeat(181),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects malformed stored JSON", () => {
    expect(() => parseDemoLandingContent("{oops")).toThrow(/formato inválido/);
  });

  it("keeps public calls to action aligned with the information section", () => {
    expect(normalizeDemoCtaLabel("Conhecer detalhes")).toBe("Conhecer detalhes");
    expect(normalizeDemoCtaLabel("Pedir orçamento")).toBe("Ver informações");
  });

  it("requires at least one editable field in PATCH", () => {
    expect(updateDemoLandingSchema.safeParse({}).success).toBe(false);
    expect(updateDemoLandingSchema.safeParse({ status: "APPROVED" }).success).toBe(true);
    expect(updateDemoLandingSchema.safeParse({ status: "PUBLISHED" }).success).toBe(false);
  });
});
