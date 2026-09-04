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
    // Os literais abaixo são valores observados para Barbearia/semente-fixa;
    // uma mudança na paleta, no raio ou na fonte dessa direção os altera.
    const vars = toCssVariables(direction);
    expect(vars["--surface"]).toBe("#000000");
    expect(vars["--ink"]).toBe("#F0F1F2");
    expect(vars["--accent"]).toBe("#8FA3AD");
    expect(vars["--radius"]).toBe("0px");
    expect(vars["--font-display"]).toBe("var(--font-inter-tight)");
  });

  it("emite os cinco tokens do hero", () => {
    // Barbearia herda o chão: os tokens do hero são os do site, e é isso que
    // deixa o renderizador endereçar o hero sem um segundo caminho de código.
    const vars = toCssVariables(direction);
    expect(vars["--hero-surface"]).toBe(direction.palette.surface);
    expect(vars["--hero-ink"]).toBe(direction.palette.ink);
    expect(vars["--hero-ink-muted"]).toBe(direction.palette.inkMuted);
    expect(vars["--hero-accent"]).toBe(direction.palette.accent);
    expect(vars["--hero-spotlight"]).toBe("#FFFFFF33");
  });

  it("inverte os tokens do hero quando a direção abre no escuro sobre um corpo claro", () => {
    const food = resolveArtDirection({ sector: "Pizzaria", seed: "semente-fixa" });
    const vars = toCssVariables(food);
    expect(food.hero.ground).toBe("dark");
    expect(vars["--hero-surface"]).toBe("#000000");
    expect(vars["--hero-ink"]).toBe(food.palette.surface);
    expect(vars["--hero-ink-muted"]).not.toBe(food.palette.inkMuted);
    // O corpo continua no chão da direção: dois chãos, nunca três.
    expect(vars["--surface"]).toBe(food.palette.surface);
  });

  it("acende o spotlight com o acento quando o hero é claro", () => {
    const light = resolveArtDirection({ sector: "Advocacia", seed: "semente-fixa" });
    expect(light.hero.ground).toBe("inherit");
    expect(light.ground).toBe("light");
    expect(toCssVariables(light)["--hero-spotlight"]).toBe(`${light.palette.accent}2E`);
  });

  it("zera --motion-max quando a direção não tem movimento de entrada", () => {
    const noMotion = resolveArtDirection({ sector: "Advocacia", seed: "semente-fixa" });
    expect(noMotion.motion.moment).toBe("none");
    expect(toCssVariables(noMotion)["--motion-max"]).toBe("0ms");
    expect(toDesignMarkdown(noMotion)).toContain("--motion-max: 0ms;");
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

  it("descreve o contrato do hero, para o agente construir o mesmo que a prévia", () => {
    expect(markdown).toContain("### Hero");
    const hero = markdown.split("### Hero")[1].split("## Do's and Don'ts")[0];
    expect(hero).toContain("88vh");
    expect(hero).toContain("clamp(3rem, 8vw, 7rem)");
    expect(hero).toContain("data-hero-spotlight");
    expect(hero).toContain("data-category-motif");
    expect(hero).toContain(direction.hero.motif);
    expect(hero).toContain("--hero-ink-muted");
  });

  it("conta ao agente que o gradiente e o glow valem uma vez, no hero", () => {
    const dont = markdown.split("### Don't")[1];
    expect(dont).toContain("fora do hero");
    expect(dont).toContain("O spotlight do hero é permitido uma vez.");
    expect(dont).toContain("No máximo dois chãos");
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

  it("resolve --font-display e --font-body do :root para uma pilha de fontes real, não para o token de preview do next/font", () => {
    expect(markdown).not.toContain("var(--font-");

    const displayFamily = markdown.match(/### Display — `--font-display`\n- \*\*Family:\*\* (.+)/)?.[1];
    const bodyFamily = markdown.match(/### Body — `--font-body`\n- \*\*Family:\*\* (.+)/)?.[1];
    expect(displayFamily).toBeTruthy();
    expect(bodyFamily).toBeTruthy();

    expect(markdown).toContain(`--font-display: ${displayFamily};`);
    expect(markdown).toContain(`--font-body: ${bodyFamily};`);
  });

  it("o :root do DESIGN.md é o mesmo mapa que toCssVariables emite, chave a chave", () => {
    const vars = toCssVariables(direction);
    for (const [key, value] of Object.entries(vars)) {
      if (key === "--font-display" || key === "--font-body") continue;
      expect(markdown, key).toContain(`${key}: ${value};`);
    }
  });
});
