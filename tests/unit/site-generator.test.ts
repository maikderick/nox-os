import { describe, expect, it } from "vitest";

import { findClaimRisks } from "@/lib/content-integrity";
import { demoLandingContentSchema } from "@/lib/demo-landing-schema";
import type { SiteBriefV2 } from "@/lib/site-factory/brief-schema";
import {
  briefToDemoLead,
  buildSiteContentFromBrief,
  channelsFromBrief,
  ctaLabelFor,
  paletteFor,
  sectorFamily,
} from "@/lib/site-generator";

const AT = "2026-09-03T12:00:00.000Z";
const fact = (value: string) => ({ value, source: "OPERADOR" as const, confirmedAt: AT });

function brief(overrides: Partial<SiteBriefV2> = {}): SiteBriefV2 {
  return {
    schemaVersion: 2,
    businessName: fact("Goku Lanches"),
    sector: fact("Hamburgueria"),
    city: fact("Recife"),
    objective: fact("Receber pedidos e dúvidas pelo WhatsApp a partir do site."),
    audience: fact("famílias do bairro e quem trabalha na região."),
    positioning: fact("Comunicação direta e objetiva: o cliente encontra o que precisa e pede em poucos toques."),
    differentiators: [fact("Entrega no bairro"), fact("Pão feito na casa")],
    desiredSections: ["Cardápio", "Contato"],
    visualDirection: fact("Tons quentes como terracota e âmbar, texturas discretas."),
    notes: null,
    services: [
      {
        id: "smash-burger",
        name: fact("Smash burger"),
        summary: { ...fact("Blend bovino, queijo e molho da casa no pão brioche.") },
        body: [fact("Preparado na chapa na hora.")],
        relatedIds: [],
        featured: false,
      },
      {
        id: "combo-familia",
        name: fact("Combo família"),
        summary: { ...fact("Quatro lanches, batata e refrigerante.") },
        body: [fact("Serve quatro pessoas.")],
        relatedIds: [],
        featured: true,
      },
    ],
    publicContact: {
      phone: { value: "+5581991110001", source: "OPERADOR", confirmedAt: AT },
      whatsapp: { value: "+5581991110001", source: "OPERADOR", confirmedAt: AT },
      email: null,
      address: {
        value: {
          street: "R. Maurício Carrara",
          number: "64",
          complement: null,
          neighborhood: "Vila Teresa",
          city: "Recife",
          state: "PE",
          postalCode: null,
          country: "Brasil",
        },
        source: "OPERADOR",
        confirmedAt: AT,
      },
      coordinates: null,
      openingHours: null,
      socialLinks: [],
    },
    metaDescription: null,
    ...overrides,
  };
}

describe("sectorFamily", () => {
  it("maps sectors to their family", () => {
    expect(sectorFamily("Hamburgueria")).toBe("food");
    expect(sectorFamily("Barbearia")).toBe("beauty");
    expect(sectorFamily("Escritório de advocacia")).toBe("professional");
    expect(sectorFamily("Clínica odontológica")).toBe("health");
    expect(sectorFamily("Algo inédito")).toBe("default");
  });
});

describe("paletteFor", () => {
  it("follows the visual direction words before the sector default", () => {
    expect(paletteFor("Hamburgueria", "Tons quentes e artesanais")).toEqual({ primary: "#c2410c", accent: "#f59e0b" });
    expect(paletteFor("Hamburgueria", "")).toEqual({ primary: "#dc2626", accent: "#f59e0b" });
  });
});

describe("ctaLabelFor", () => {
  it("prefers WhatsApp actions that match the objective", () => {
    const b = brief();
    expect(ctaLabelFor(b, channelsFromBrief(b))).toBe("Pedir no WhatsApp");
  });

  it("falls back to phone, then to contact", () => {
    const withPhone = brief({ publicContact: { ...brief().publicContact, whatsapp: null } });
    expect(ctaLabelFor(withPhone, channelsFromBrief(withPhone))).toBe("Ligar agora");
    const nothing = brief({ publicContact: { ...brief().publicContact, whatsapp: null, phone: null } });
    expect(ctaLabelFor(nothing, channelsFromBrief(nothing))).toBe("Ver contato");
  });
});

describe("buildSiteContentFromBrief", () => {
  const content = buildSiteContentFromBrief({ brief: brief(), lead: { latitude: -8.05, longitude: -34.9 } });

  it("produces content the public schema accepts", () => {
    expect(() => demoLandingContentSchema.parse(content)).not.toThrow();
    expect(content.headline).toBe("Goku Lanches");
    expect(content.primaryColor).toBe("#c2410c");
  });

  it("uses confirmed services, featured first, and the sector's vocabulary", () => {
    expect(content.servicesTitle).toBe("Cardápio");
    expect(content.services[0]).toBe("Combo família — Quatro lanches, batata e refrigerante.");
    expect(content.services).toHaveLength(2);
    expect(content.processTitle).toBe("Como pedir");
  });

  it("turns confirmed differentiators into benefits", () => {
    expect(content.benefits).toEqual(["Entrega no bairro", "Pão feito na casa"]);
    expect(content.factsTitle).toBe("Por que escolher");
  });

  it("answers from facts only: address, WhatsApp, services", () => {
    const questions = content.faqs.map((faq) => faq.question);
    expect(questions).toContain("Onde fica Goku Lanches?");
    expect(questions).toContain("Como falar com Goku Lanches?");
    expect(content.faqs.find((faq) => faq.question.startsWith("Onde fica"))?.answer).toContain("R. Maurício Carrara, 64");
    expect(content.whatsappE164).toBe("+5581991110001");
    expect(content.ctaLabel).toBe("Pedir no WhatsApp");
  });

  it("carries the confirmed contact into the snapshot, with lead coordinates", () => {
    expect(content.businessSnapshot?.phoneE164).toBe("+5581991110001");
    expect(content.businessSnapshot?.address).toBe("R. Maurício Carrara, 64");
    expect(content.businessSnapshot?.latitude).toBe(-8.05);
  });

  it("never writes a claim the integrity rules would flag", () => {
    const texts = [
      content.headline,
      content.subheadline,
      content.about,
      content.servicesIntro,
      content.processIntro,
      ...content.processSteps,
      content.finalCtaTitle,
      content.finalCtaText,
      content.galleryIntro,
    ];
    for (const text of texts) {
      expect(findClaimRisks([{ field: "texto", value: text }], { allow: ["contato"] })).toEqual([]);
    }
    expect(JSON.stringify(content)).not.toMatch(/melhor|garanti|R\$/i);
  });

  it("copes with a brief that confirmed nothing beyond the narrative", () => {
    const bare = buildSiteContentFromBrief({
      brief: brief({
        services: [],
        differentiators: [],
        publicContact: { phone: null, whatsapp: null, email: null, address: null, coordinates: null, openingHours: null, socialLinks: [] },
      }),
    });
    expect(bare.services).toEqual([]);
    expect(bare.whatsappE164).toBeNull();
    expect(bare.ctaLabel).toBe("Ver contato");
    expect(bare.benefits.length).toBeGreaterThan(0);
    expect(() => demoLandingContentSchema.parse(bare)).not.toThrow();
  });
});

describe("briefToDemoLead", () => {
  it("prefers the brief's address over the lead's", () => {
    const lead = briefToDemoLead(brief(), { city: "Olinda", state: "PE" });
    expect(lead.city).toBe("Recife");
    expect(lead.neighborhood).toBe("Vila Teresa");
    expect(lead.website).toBeNull();
  });
});
