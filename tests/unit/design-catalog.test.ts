import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { DIRECTION_CATALOG } from "@/lib/design/catalog";
import type { CategoryId } from "@/lib/design/category";
import { resolveHeroPalette } from "@/lib/design/tokens";

// Reads the loaded roster straight out of site-fonts.tsx, rather than
// hardcoding a third copy of the list here, so that removing a family from
// site-fonts.tsx fails this test instead of silently falling back to the
// system face at render time.
const SITE_FONTS_SOURCE = readFileSync("src/components/sites/site-fonts.tsx", "utf8");
const FONT_ROSTER = new Set(
  [...SITE_FONTS_SOURCE.matchAll(/variable:\s*"--font-([a-z0-9-]+)"/g)].map((match) => match[1]),
);

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

/** The sector text that resolves to each category, for a round trip. */
const CATEGORY_LABELS = Object.fromEntries(
  CATEGORY_GROUPS.map((group) => [group.id, group.label]),
) as Record<CategoryId, string>;

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
    // Pins the roster itself: if a family is added to or removed from
    // site-fonts.tsx without updating this list, this fails here first.
    expect([...FONT_ROSTER].sort()).toEqual([
      "archivo", "dm-mono", "fraunces", "instrument-serif",
      "inter", "inter-tight", "source-serif", "work-sans",
    ]);
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

  it("todo acento alcança 3:1 sobre as duas superfícies, porque o site-kit o usa como preenchimento primário", () => {
    for (const id of categoryIds) {
      for (const palette of DIRECTION_CATALOG[id].palettes) {
        expect(contrast(palette.accent, palette.surface), `${id} accent/surface`).toBeGreaterThanOrEqual(3);
        expect(contrast(palette.accent, palette.surfaceAlt), `${id} accent/surfaceAlt`).toBeGreaterThanOrEqual(3);
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

  // A reversão de 2026-09-04 (spec §13, errata 6). O hero passou a poder ter
  // chão próprio, e o preço disso é que a inversão precisa continuar legível:
  // um `--hero-ink` derivado que não alcança AA sobre `--hero-surface` é um
  // título ilegível em produção, não um detalhe de tema.
  const DARK_HERO: CategoryId[] = ["food", "fitness", "auto", "retail", "events"];

  const MOTIF_BY_CATEGORY: Record<CategoryId, string> = {
    food: "azulejo", beauty: "navalha", fitness: "placar", pet: "patas",
    auto: "manual", education: "grade-horaria", retail: "vitrine",
    events: "passe-partout", realestate: "planta", professional: "encadernacao",
    health: "luz-difusa", services: "ficha", tourism: "entardecer", catalog: "indice",
  };

  it("dá a cada categoria o motivo da sua própria tabela, e nenhum repetido", () => {
    for (const id of categoryIds) {
      expect(DIRECTION_CATALOG[id].hero.motif, `${id}.hero.motif`).toBe(MOTIF_BY_CATEGORY[id]);
    }
    expect(new Set(categoryIds.map((id) => DIRECTION_CATALOG[id].hero.motif)).size).toBe(14);
  });

  it("abre no escuro só nas cinco categorias que o dono escolheu", () => {
    for (const id of categoryIds) {
      const expected = DARK_HERO.includes(id) ? "dark" : "inherit";
      expect(DIRECTION_CATALOG[id].hero.ground, `${id}.hero.ground`).toBe(expected);
    }
  });

  it("nunca inverte um chão que já é escuro: seria preto sobre preto", () => {
    for (const id of DARK_HERO) {
      expect(DIRECTION_CATALOG[id].ground, `${id}.ground`).toBe("light");
    }
  });

  it("passa AA de contraste entre a tinta do hero e a superfície do hero", () => {
    for (const id of categoryIds) {
      for (const seed of ["semente-a", "semente-b", "semente-c", "semente-d"]) {
        const direction = resolveArtDirection({ sector: CATEGORY_LABELS[id], seed });
        const hero = resolveHeroPalette(direction);
        expect(contrast(hero.ink, hero.surface), `${id} hero ink/surface`)
          .toBeGreaterThanOrEqual(4.5);
        expect(contrast(hero.inkMuted, hero.surface), `${id} hero inkMuted/surface`)
          .toBeGreaterThanOrEqual(4.5);
        // O acento é a única cor que o motivo tem; um objeto que some no chão
        // não é um objeto.
        expect(contrast(hero.accent, hero.surface), `${id} hero accent/surface`)
          .toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("o hero escuro é preto puro, e o herdado é o chão do próprio site", () => {
    for (const id of categoryIds) {
      const direction = resolveArtDirection({ sector: CATEGORY_LABELS[id], seed: "semente" });
      const hero = resolveHeroPalette(direction);
      if (DIRECTION_CATALOG[id].hero.ground === "dark") {
        expect(hero.surface, `${id}`).toBe("#000000");
        expect(hero.ground, `${id}`).toBe("dark");
      } else {
        expect(hero.surface, `${id}`).toBe(direction.palette.surface);
        expect(hero.ink, `${id}`).toBe(direction.palette.ink);
        expect(hero.inkMuted, `${id}`).toBe(direction.palette.inkMuted);
      }
    }
  });

  it("nunca deriva um quase-preto para o hero", () => {
    for (const id of categoryIds) {
      const direction = resolveArtDirection({ sector: CATEGORY_LABELS[id], seed: "semente" });
      const hero = resolveHeroPalette(direction);
      for (const value of [hero.surface, hero.ink, hero.inkMuted, hero.accent]) {
        const r = parseInt(value.slice(1, 3), 16);
        const g = parseInt(value.slice(3, 5), 16);
        const b = parseInt(value.slice(5, 7), 16);
        expect(r === g && g === b && r > 0 && r < 0x13, `${id} ${value}`).toBe(false);
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
