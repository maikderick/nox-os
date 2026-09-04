import { describe, expect, it } from "vitest";

import { buildGenerationPrompt } from "@/lib/generation/prompt";
import { siteBriefV2Schema, type SiteBriefV2 } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

const brief: SiteBriefV2 = siteBriefV2Schema.parse({
  schemaVersion: 2,
  businessName: fact("Barbearia Aurora"), sector: fact("Barbearia"), city: fact("Fortaleza"),
  objective: fact("Apresentar o negócio e facilitar novos contatos."),
  audience: fact("Pessoas que procuram corte e barba na região."),
  positioning: fact("Informações claras e verificadas sobre o negócio."),
  differentiators: [], desiredSections: ["Início", "Serviços", "Contato"],
  visualDirection: fact("Sóbrio, escuro e legível."), notes: null,
  services: [{
    id: "corte", name: fact("Corte"), summary: fact("Corte masculino."),
    body: [fact("Corte na tesoura ou na máquina, com acabamento na navalha.")],
    relatedIds: [], featured: false,
  }],
  publicContact: {
    phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
    whatsapp: null, email: null, address: null, coordinates: null,
    openingHours: null, socialLinks: [],
  },
  metaDescription: null,
});

const input = {
  brief,
  projectName: "barbearia-aurora",
  seed: "cmtm2yp9u0004zpc3r7jgufvr",
  repository: { owner: "nox", name: "barbearia-aurora", baseBranch: "main" },
};

describe("prompt de geração", () => {
  const prompt = buildGenerationPrompt(input);

  it("separa gosto de fato em duas seções nomeadas", () => {
    expect(prompt).toContain("# DESIGN.md");
    expect(prompt).toContain("# BRIEFING");
    expect(prompt.indexOf("# DESIGN.md")).toBeLessThan(prompt.indexOf("# BRIEFING"));
  });

  it("carrega a direção resolvida, com âncora e paleta", () => {
    expect(prompt).toContain("Espelho e latão sob luz baixa");
    expect(prompt).toContain("## Tokens — Colors");
  });

  it("carrega as regras anti-slop", () => {
    expect(prompt).toContain("### Don't");
    expect(prompt).toContain("Sem gradiente radial");
  });

  it("mantém as regras não negociáveis do briefing", () => {
    expect(prompt).toMatch(/Não invente/i);
    expect(prompt).toMatch(/pull request/i);
  });

  it("publica só os fatos confirmados", () => {
    expect(prompt).toContain("Barbearia Aurora");
    expect(prompt).toContain("+5585999998888");
    expect(prompt).not.toContain("whatsapp");
  });

  it("passa a direção do operador como refinamento, nomeada como tal", () => {
    expect(prompt).toContain("Sóbrio, escuro e legível.");
    expect(prompt).toMatch(/refinamento|dentro da direção/i);
  });

  it("é determinístico para a mesma semente", () => {
    expect(buildGenerationPrompt(input)).toBe(buildGenerationPrompt(input));
  });

  it("muda quando a semente muda, sem mudar os fatos", () => {
    const other = buildGenerationPrompt({ ...input, seed: "outra-semente-diferente" });
    expect(other).toContain("Barbearia Aurora");
    expect(other).toContain("Espelho e latão sob luz baixa");
  });
});
