import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { FALLBACK_CATEGORY_ID, resolveCategoryId } from "@/lib/design/category";

describe("resolução de categoria a partir do setor", () => {
  it("resolve todo grupo pelo próprio rótulo", () => {
    for (const group of CATEGORY_GROUPS) {
      expect(resolveCategoryId(group.label)).toBe(group.id);
    }
  });

  it("resolve todo grupo por cada uma das suas palavras-chave", () => {
    for (const group of CATEGORY_GROUPS) {
      for (const keyword of group.keywords) {
        expect(resolveCategoryId(keyword)).toBe(group.id);
      }
    }
  });

  it("ignora acento e caixa", () => {
    expect(resolveCategoryId("ADVOCACIA")).toBe("professional");
    expect(resolveCategoryId("estetica")).toBe("beauty");
    expect(resolveCategoryId("Veterinária")).toBe("pet");
  });

  it("resolve o que um operador realmente digita", () => {
    expect(resolveCategoryId("Escritório de advocacia")).toBe("professional");
    expect(resolveCategoryId("advogado")).toBe("professional");
    expect(resolveCategoryId("contador")).toBe("professional");
    expect(resolveCategoryId("consultoria contábil")).toBe("professional");
    expect(resolveCategoryId("barbearia masculina")).toBe("beauty");
    expect(resolveCategoryId("clínica odontológica")).toBe("health");
    expect(resolveCategoryId("pousada")).toBe("tourism");
    expect(resolveCategoryId("hamburgueria")).toBe("food");
    // A pool is a hotel feature far more often than it is a business, so the
    // `services` catalogue names the trade, not the object.
    expect(resolveCategoryId("hotel com piscina")).toBe("tourism");
  });

  it("cai no fallback documentado para setor desconhecido", () => {
    expect(resolveCategoryId("consultoria em blockchain")).toBe(FALLBACK_CATEGORY_ID);
    expect(resolveCategoryId("")).toBe(FALLBACK_CATEGORY_ID);
    expect(FALLBACK_CATEGORY_ID).toBe("services");
  });

  it("não toca relógio nem aleatoriedade", () => {
    const source = readFileSync("src/lib/design/category.ts", "utf8");
    expect(source).not.toMatch(/Date\.now|Math\.random|new Date/);
  });
});
