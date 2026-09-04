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

  it("emite localização, e não contato, quando só o endereço foi confirmado", () => {
    const brief = briefV2({
      desiredSections: ["Início", "Contato"],
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
    const { blocks, unmapped } = resolveComposition(brief);
    expect(blocks).toContain("location");
    // An address is a place, not a channel: it opens `location`, which owns it.
    // The operator asked for "Contato" and no channel was confirmed, so the
    // request is reported rather than answered with an empty section.
    expect(blocks).not.toContain("contact");
    expect(unmapped).toContain("Contato");
  });

  it("emite localização e contato quando há endereço e canal confirmados", () => {
    const brief = briefV2({
      desiredSections: ["Início", "Contato"],
      publicContact: {
        phone: {
          value: "+5585999998888",
          source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z",
        },
        whatsapp: null, email: null,
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
    const { blocks, unmapped } = resolveComposition(brief);
    expect(blocks).toContain("location");
    expect(blocks).toContain("contact");
    expect(unmapped).not.toContain("Contato");
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

  it("não desvia uma seção que apenas contém um alias dentro de outra palavra", () => {
    const { blocks, unmapped } = resolveComposition(
      briefV2({ desiredSections: ["Início", "Sobremesas", "Homenagem", "Capacidade de atendimento", "Topografia"] }),
    );
    for (const section of ["Sobremesas", "Homenagem", "Capacidade de atendimento", "Topografia"]) {
      expect(unmapped, section).toContain(section);
    }
    expect(blocks).toContain("hero");
  });

  it("continua casando alias como palavra inteira e como frase", () => {
    const { unmapped } = resolveComposition(
      briefV2({ desiredSections: ["Sobre nós", "Quem somos", "Início", "Onde estamos"] }),
    );
    expect(unmapped).not.toContain("Sobre nós");
    expect(unmapped).not.toContain("Quem somos");
    expect(unmapped).not.toContain("Início");
    // "Onde estamos" maps to `location`, which the default fixture does not confirm —
    // so it is reported, and that is correct.
    expect(unmapped).toContain("Onde estamos");
  });

  it("reporta a seção pedida cujo bloco não está disponível por falta de fato confirmado", () => {
    const { blocks, unmapped } = resolveComposition(briefV2({ desiredSections: ["Início", "Horários"] }));
    expect(unmapped).toContain("Horários");
    expect(blocks).not.toContain("hours");
  });
});
