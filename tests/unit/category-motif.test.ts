import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryMotif } from "@/components/sites/category-motif";
import { findSlop } from "@/lib/design/anti-slop";
import type { MotifId } from "@/lib/design/art-direction";
import { DIRECTION_CATALOG } from "@/lib/design/catalog";

const MOTIFS: MotifId[] = [
  "azulejo", "navalha", "placar", "patas", "manual", "grade-horaria", "vitrine",
  "passe-partout", "planta", "encadernacao", "luz-difusa", "ficha", "entardecer", "indice",
];

function draw(motif: MotifId): string {
  return renderToStaticMarkup(React.createElement(CategoryMotif, { motif }));
}

/** Every SVG element in the markup, minus the scoped `<style>` and the root. */
function elements(html: string): string[] {
  return [...html.matchAll(/<(?!\/)([a-zA-Z][a-zA-Z0-9]*)\b/g)]
    .map((match) => match[1])
    .filter((tag) => tag !== "style" && tag !== "svg");
}

describe("motivo por categoria", () => {
  it("cobre exatamente os motivos que o catálogo pede", () => {
    const wanted = new Set(Object.values(DIRECTION_CATALOG).map((entry) => entry.hero.motif));
    expect([...wanted].sort()).toEqual([...MOTIFS].sort());
  });

  it("marca todo motivo para o linter e para o leitor de tela", () => {
    for (const motif of MOTIFS) {
      const html = draw(motif);
      expect(html, motif).toContain('data-category-motif=""');
      expect(html, motif).toContain(`data-motif="${motif}"`);
      expect(html, motif).toContain('aria-hidden="true"');
    }
  });

  it("cabe em sessenta elementos: é um desenho, não uma cena", () => {
    for (const motif of MOTIFS) {
      expect(elements(draw(motif)).length, motif).toBeLessThanOrEqual(60);
    }
  });

  it("não usa imagem raster nem foreignObject", () => {
    for (const motif of MOTIFS) {
      const html = draw(motif);
      expect(html, motif).not.toContain("<image");
      expect(html, motif).not.toContain("foreignObject");
      expect(html, motif).not.toContain("data:image");
    }
  });

  it("tira toda cor de custom property: nada de hex solto no desenho", () => {
    for (const motif of MOTIFS) {
      const html = draw(motif);
      expect(html, motif).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html, motif).not.toMatch(/\brgba?\(/);
      for (const value of [...html.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1])) {
        if (value === "none" || value.startsWith("url(")) continue;
        expect(value, `${motif}: ${value}`).toMatch(/^var\(--hero-(ink|accent|surface)\)$/);
      }
    }
  });

  it("anima uma vez só, devagar, e nunca para quem pediu quietude", () => {
    for (const motif of MOTIFS) {
      const html = draw(motif);
      const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
      expect(style, motif).toContain("@media (prefers-reduced-motion:no-preference)");
      // Uma declaração de animação por motivo, e a duração dentro da faixa
      // que o dono pediu: 8 a 14 segundos.
      const durations = [...style.matchAll(/animation:[a-z-]+ (\d+)s/g)].map((m) => Number(m[1]));
      expect(durations.length, `${motif}: animações`).toBe(1);
      expect(durations[0], `${motif}: duração`).toBeGreaterThanOrEqual(8);
      expect(durations[0], `${motif}: duração`).toBeLessThanOrEqual(14);
      // Escopado pelo id do motivo: dois motivos nunca se estilizam entre si.
      expect(style, motif).toContain(`[data-motif="${motif}"]`);
    }
  });

  it("não publica texto, só numerais decorativos", () => {
    for (const motif of MOTIFS) {
      for (const text of [...draw(motif).matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1])) {
        expect(text.trim(), `${motif}: "${text}"`).toMatch(/^[0-9:]*$/);
      }
    }
  });

  it("não esconde slop atrás da isenção que o linter lhe dá", () => {
    // `findSlop` recorta o motivo inteiro antes de medir, e uma isenção larga
    // assim só é honesta se o desenho passasse mesmo sem ela. Passa: até o
    // borrão do `luz-difusa` é um `feGaussianBlur` dentro do SVG, não um
    // `filter: blur()` de CSS atrás do conteúdo, que é o que a regra 2 existe
    // para pegar. A isenção cobre o que ainda não foi desenhado, não uma
    // dívida já contraída.
    for (const motif of MOTIFS) {
      const bare = draw(motif).replace('data-category-motif=""', "");
      expect(findSlop(bare).map((rule) => rule.id), motif).toEqual([]);
    }
  });
});
