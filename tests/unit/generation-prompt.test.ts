import { describe, expect, it } from "vitest";

import { resolveArtDirection } from "@/lib/design/art-direction";
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
    expect(prompt).toContain(
      "Refinamento do operador, a ser aplicado dentro da direção acima, sem trocar nenhum token:",
    );
    // The operator's free text steers only the facts half; it must never leak
    // into the taste half, or it could be read as a token override.
    expect(prompt.split("# DESIGN.md")[1].split("# BRIEFING")[0]).not.toContain("Sóbrio, escuro e legível.");
  });

  it("nunca entrega ao agente o que o operador respondeu sobre a encomenda", () => {
    // A terceira via de publicação. O snapshot e o renderizador já não levam
    // `objective`/`audience`; o prompt levava — sob "use apenas os fatos
    // listados abaixo", entregues ao modelo que escreve a copy do site. Este
    // é o teste que impede a volta.
    expect(prompt).not.toContain("Apresentar o negócio e facilitar novos contatos.");
    expect(prompt).not.toContain("Pessoas que procuram corte e barba na região.");
    expect(prompt).not.toMatch(/^- Objetivo:/m);
    expect(prompt).not.toMatch(/^- Público:/m);
  });

  it("entrega a apresentação confirmada como fato publicável", () => {
    const withAbout = buildGenerationPrompt({
      ...input,
      brief: siteBriefV2Schema.parse({
        ...brief,
        about: fact("A Barbearia Aurora atende corte e barba no centro de Fortaleza."),
      }),
    });

    expect(withAbout).toContain(
      "- Apresentação: A Barbearia Aurora atende corte e barba no centro de Fortaleza.",
    );
    // E continua sem os campos internos.
    expect(withAbout).not.toContain("Pessoas que procuram corte e barba na região.");
  });

  it("cai no posicionamento quando o briefing não tem apresentação", () => {
    // Um briefing anterior a `about` não deixa o agente sem nenhuma frase
    // escrita para o visitante.
    expect(prompt).toContain(
      "- Apresentação: Informações claras e verificadas sobre o negócio.",
    );
  });

  it("chama o negócio pelo mesmo nome que o site e o <title> usam", () => {
    const shouted = buildGenerationPrompt({
      ...input,
      brief: siteBriefV2Schema.parse({ ...brief, businessName: fact("ZEN COMIDA JAPONESA") }),
    });

    expect(shouted).toContain("Zen Comida Japonesa");
    expect(shouted).not.toContain("ZEN COMIDA JAPONESA");
  });

  it("é determinístico para a mesma semente", () => {
    expect(buildGenerationPrompt(input)).toBe(buildGenerationPrompt(input));
  });

  it("muda quando a semente muda, sem mudar os fatos", () => {
    const otherSeed = "outra-semente-diferente";
    const other = buildGenerationPrompt({ ...input, seed: otherSeed });

    // The two seeds must land on different variants, or this test proves nothing.
    // Deterministic: "cmtm2yp9u0004zpc3r7jgufvr" -> beauty/niquel/v1 and
    // "outra-semente-diferente" -> beauty/latao/v1 — they differ, verified by
    // resolveArtDirection directly below. If this pair ever collided, the fix
    // would be to pick another otherSeed and update this comment.
    const a = resolveArtDirection({ sector: brief.sector.value, seed: input.seed });
    const b = resolveArtDirection({ sector: brief.sector.value, seed: otherSeed });
    expect(a.id).not.toBe(b.id);

    expect(other).not.toBe(prompt);
    expect(other).toContain("Barbearia Aurora");
    expect(other).toContain("Espelho e latão sob luz baixa");
    expect(other.split("# BRIEFING")[1]).toBe(prompt.split("# BRIEFING")[1]);
  });
});
