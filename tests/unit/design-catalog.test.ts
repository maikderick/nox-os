import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { DIRECTION_CATALOG } from "@/lib/design/catalog";
import type { CategoryId } from "@/lib/design/category";

const FONT_ROSTER = new Set([
  "fraunces", "source-serif", "instrument-serif", "archivo",
  "inter-tight", "inter", "work-sans", "dm-mono",
]);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const categoryIds = CATEGORY_GROUPS.map((group) => group.id as CategoryId);

describe("catálogo de direções de arte", () => {
  it("cobre exatamente as categorias existentes", () => {
    expect(Object.keys(DIRECTION_CATALOG).sort()).toEqual([...categoryIds].sort());
  });

  it("dá a toda categoria pelo menos duas opções em cada eixo, senão dois clientes da mesma categoria saem com o mesmo site", () => {
    for (const id of categoryIds) {
      const entry = DIRECTION_CATALOG[id];
      expect(entry.palettes.length, `${id}.palettes`).toBeGreaterThanOrEqual(2);
      expect(entry.types.length, `${id}.types`).toBeGreaterThanOrEqual(2);
      expect(entry.rhythms.length, `${id}.rhythms`).toBeGreaterThanOrEqual(2);
      expect(entry.anchor.length, `${id}.anchor`).toBeGreaterThan(0);
    }
  });

  it("nomeia toda paleta: paletteNames tem o mesmo tamanho que palettes", () => {
    for (const id of categoryIds) {
      const entry = DIRECTION_CATALOG[id];
      expect(entry.paletteNames.length, `${id}.paletteNames`).toBe(entry.palettes.length);
    }
  });

  it("só referencia fontes do roster carregado", () => {
    for (const id of categoryIds) {
      for (const type of DIRECTION_CATALOG[id].types) {
        expect(FONT_ROSTER.has(type.display), `${id} display ${type.display}`).toBe(true);
        expect(FONT_ROSTER.has(type.body), `${id} body ${type.body}`).toBe(true);
      }
    }
  });

  it("usa hex de seis dígitos em toda cor", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        for (const [name, value] of Object.entries(palette)) {
          expect(value, `${id}.${name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });

  it("passa AA de contraste entre tinta e superfície em toda paleta", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        expect(contrast(palette.ink, palette.surface), `${id} ink/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.inkMuted, palette.surface), `${id} inkMuted/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.ink, palette.surfaceAlt), `${id} ink/surfaceAlt`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("dá a health contraste AAA no corpo, porque o público é mais velho", () => {
    for (const palette of DIRECTION_CATALOG.health.palettes) {
      expect(contrast(palette.ink, palette.surface)).toBeGreaterThanOrEqual(7);
    }
  });

  // `#131313` — o `ink` da primeira paleta de `catalog` — precisa continuar
  // passando: ele vem do dado de origem (a tabela de tokens), não foi
  // inventado. É por isso que o limite é 0x13: é o cinza neutro mais escuro
  // que os tokens realmente usam, então qualquer cinza neutro mais escuro
  // que ele — mas que não seja preto puro — é invenção, exatamente a mesma
  // armadilha de "quase-preto no lugar de preto" que esta regra existe para
  // barrar. Não mova esse limite sem revisitar a tabela de tokens de origem.
  it("nunca usa quase-preto no lugar de preto", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        for (const value of Object.values(palette)) {
          const r = parseInt(value.slice(1, 3), 16);
          const g = parseInt(value.slice(3, 5), 16);
          const b = parseInt(value.slice(5, 7), 16);
          const isForbiddenNearBlack = r === g && g === b && r > 0 && r < 0x13;
          expect(isForbiddenNearBlack, `${id} ${value}`).toBe(false);
        }
      }
    }
  });

  it("respeita o orçamento de movimento", () => {
    for (const id of categoryIds) {
      const { motion } = DIRECTION_CATALOG[id];
      expect(motion.maxMs, `${id}.motion.maxMs`).toBeLessThanOrEqual(200);
      expect(["hero-wordmark", "hero-image", "none"]).toContain(motion.moment);
    }
  });
});

describe("resolução da direção", () => {
  it("é determinística: mesma entrada, mesma saída", () => {
    const input = { sector: "Barbearia", seed: "cmtm2yp9u0004zpc3r7jgufvr" };
    expect(resolveArtDirection(input)).toEqual(resolveArtDirection(input));
  });

  it("resolve para a categoria do setor", () => {
    expect(resolveArtDirection({ sector: "Advocacia", seed: "s" }).categoryId).toBe("professional");
    expect(resolveArtDirection({ sector: "Pizzaria", seed: "s" }).categoryId).toBe("food");
  });

  it("mantém a identidade da categoria e varia o resto entre sementes", () => {
    const seeds = Array.from({ length: 24 }, (_, index) => `projeto-${index}`);
    const resolved = seeds.map((seed) => resolveArtDirection({ sector: "Barbearia", seed }));

    expect(new Set(resolved.map((d) => d.categoryId))).toEqual(new Set(["beauty"]));
    expect(new Set(resolved.map((d) => d.anchor)).size).toBe(1);
    expect(new Set(resolved.map((d) => d.id)).size).toBeGreaterThan(1);
  });

  it("resolve toda categoria sem lançar", () => {
    for (const group of CATEGORY_GROUPS) {
      const direction = resolveArtDirection({ sector: group.label, seed: "semente" });
      expect(direction.categoryId).toBe(group.id);
      expect(direction.id).toContain(group.id);
    }
  });

  it("não toca relógio nem aleatoriedade", () => {
    for (const path of [
      "src/lib/design/catalog.ts",
      "src/lib/design/art-direction.ts",
      "src/lib/design/category.ts",
      "src/lib/design/blocks.ts",
      "src/lib/design/tokens.ts",
      "src/lib/design/design-md.ts",
    ]) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/Date\.now|Math\.random|new Date/);
    }
  });
});
