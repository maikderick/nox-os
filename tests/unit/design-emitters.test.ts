import { describe, expect, it } from "vitest";

import { resolveArtDirection } from "@/lib/design/art-direction";
import { toDesignMarkdown } from "@/lib/design/design-md";
import { toCssVariables } from "@/lib/design/tokens";

const direction = resolveArtDirection({ sector: "Barbearia", seed: "semente-fixa" });

describe("emissor de custom properties", () => {
  it("emite toda cor da paleta", () => {
    const vars = toCssVariables(direction);
    expect(vars["--surface"]).toBe(direction.palette.surface);
    expect(vars["--ink"]).toBe(direction.palette.ink);
    expect(vars["--accent"]).toBe(direction.palette.accent);
    expect(vars["--line"]).toBe(direction.palette.line);
  });

  it("emite raio, ritmo e as famílias como variáveis de fonte", () => {
    const vars = toCssVariables(direction);
    expect(vars["--radius"]).toMatch(/^\d/);
    expect(vars["--space-section"]).toMatch(/rem$/);
    expect(vars["--font-display"]).toContain(direction.type.display);
    expect(vars["--font-body"]).toContain(direction.type.body);
  });

  it("é determinístico", () => {
    expect(toCssVariables(direction)).toEqual(toCssVariables(direction));
  });
});

describe("emissor de DESIGN.md", () => {
  const markdown = toDesignMarkdown(direction);

  it("abre com a âncora e o tema", () => {
    expect(markdown).toContain(direction.anchor);
    expect(markdown).toMatch(/\*\*Theme:\*\* dark/);
  });

  it("traz as seções que um agente espera do formato", () => {
    for (const heading of [
      "## Tokens — Colors",
      "## Tokens — Typography",
      "## Tokens — Spacing & Shapes",
      "## Components",
      "## Do's and Don'ts",
      "## Motion",
      "## Agent Prompt Guide",
      "## Quick Start",
    ]) {
      expect(markdown, heading).toContain(heading);
    }
  });

  it("traz toda cor da paleta com o hex literal", () => {
    for (const value of Object.values(direction.palette)) {
      expect(markdown).toContain(value);
    }
  });

  it("traz as quinze regras na seção Don't", () => {
    expect(markdown).toContain("### Don't");
    expect(markdown.split("### Don't")[1]).toContain("Sem gradiente radial");
  });

  it("declara o orçamento de movimento com o teto em milissegundos", () => {
    expect(markdown).toMatch(/200\s*ms/);
  });

  it("traz um bloco @theme do Tailwind v4 pronto para colar", () => {
    expect(markdown).toContain("@theme");
    expect(markdown).toContain(direction.palette.surface);
  });

  it("não vaza marca da fábrica para o site do cliente", () => {
    expect(markdown).not.toMatch(/NOX|nox-os|Claude|Anthropic|Cursor/i);
  });
});
