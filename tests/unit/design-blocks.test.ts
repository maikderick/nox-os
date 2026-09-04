import { describe, expect, it } from "vitest";

import { resolveComposition } from "@/lib/design/blocks";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function briefV2(overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact("Barbearia Aurora"),
    sector: fact("Barbearia"),
    city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas que procuram corte e barba na região."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [],
    desiredSections: ["Início", "Serviços", "Contato"],
    visualDirection: fact("Visual sóbrio e legível."),
    notes: null,
    services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
    ...overrides,
  });
}

describe("composição de blocos", () => {
  it("sempre entrega o esqueleto mínimo", () => {
    const { blocks } = resolveComposition(briefV2());
    expect(blocks).toContain("navbar");
    expect(blocks).toContain("hero");
    expect(blocks).toContain("about");
    expect(blocks).toContain("footer");
  });

  it("não emite serviços quando o briefing não confirmou nenhum", () => {
    expect(resolveComposition(briefV2()).blocks).not.toContain("services");
  });

  it("emite serviços quando há serviço confirmado", () => {
    const brief = briefV2({
      services: [{
        id: "corte", name: fact("Corte"), summary: fact("Corte masculino."),
        body: [fact("Corte na tesoura ou na máquina, com acabamento na navalha.")],
        relatedIds: [], featured: false,
      }],
    });
    expect(resolveComposition(brief).blocks).toContain("services");
  });

  it("não emite horários nem localização sem o fato correspondente", () => {
    const { blocks } = resolveComposition(briefV2());
    expect(blocks).not.toContain("hours");
    expect(blocks).not.toContain("location");
  });

  it("emite localização quando o endereço foi confirmado", () => {
    const brief = briefV2({
      publicContact: {
        phone: null, whatsapp: null, email: null,
        address: {
          value: {
            street: "Rua das Flores", number: "10", complement: null,
            neighborhood: "Centro", city: "Fortaleza", state: "CE",
            postalCode: null, country: "Brasil",
          },
          source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z",
        },
        coordinates: null, openingHours: null, socialLinks: [],
      },
    });
    const { blocks } = resolveComposition(brief);
    expect(blocks).toContain("location");
    expect(blocks).toContain("contact");
  });

  it("nunca emite bloco que exigiria inventar conteúdo", () => {
    const { blocks } = resolveComposition(briefV2());
    for (const forbidden of ["testimonials", "pricing", "faq", "stats", "logos"]) {
      expect(blocks as string[]).not.toContain(forbidden);
    }
  });

  it("reporta a seção pedida que não mapeia, em vez de ignorar em silêncio", () => {
    const brief = briefV2({ desiredSections: ["Início", "Depoimentos", "Tabela de preços"] });
    const { unmapped } = resolveComposition(brief);
    expect(unmapped).toContain("Depoimentos");
    expect(unmapped).toContain("Tabela de preços");
  });

  it("um briefing v1 não gera páginas de serviço", () => {
    const v1 = siteBriefSchema.parse({
      schemaVersion: 1,
      businessName: fact("Padaria Aurora"), sector: fact("Padaria"), city: fact("Fortaleza"),
      objective: fact("Apresentar o negócio."), audience: fact("Vizinhança."),
      positioning: fact("Informação clara e verificada."),
      services: [fact("Pães artesanais")], differentiators: [],
      desiredSections: ["Início", "Serviços"], visualDirection: fact("Sóbrio."), notes: null,
    });
    expect(resolveComposition(v1).blocks).not.toContain("services");
  });

  it("não repete bloco", () => {
    const { blocks } = resolveComposition(briefV2({ desiredSections: ["Início", "Início", "Contato"] }));
    expect(new Set(blocks).size).toBe(blocks.length);
  });
});
