import { describe, expect, it } from "vitest";

import { FALLBACK_CATEGORY_ID, resolveCategoryId } from "@/lib/design/category";
import { NICHES } from "@/lib/niches";

/**
 * A niche label is what the wizard writes into the brief's `sector`, and the
 * sector is the only input the art direction has. So a label that lands on the
 * fallback gives that whole niche the generic services look — the failure is
 * silent, and only shows up as two unrelated businesses looking alike.
 *
 * The niches below are allowed to resolve to `services` because that is what
 * they are: generic local service providers, not a category with a world of
 * its own to draw from.
 */
const ALLOWED_FALLBACK = new Set<string>([
  // "Outros serviços locais" — the wizard's explicit catch-all.
  "servicos",
  // Cleaning and conservation: "limpeza" is a `services` keyword already.
  "limpeza",
  // Technical repair shops: "assistencia tecnica" is a `services` keyword.
  "assistencia",
  // The trades below have no world of their own in the catalogue — a builder,
  // an HVAC installer and a pool technician are local service providers, and
  // `services` is where they belong, whether they match a `services` keyword
  // or arrive there as the documented fallback.
  "construcao",
  "arcondicionado",
  // "piscina" is deliberately not a `services` keyword: it is a hotel feature
  // far more often than a business, so this niche label lands on the fallback,
  // which is the same category either way.
  "piscina",
]);

describe("niches resolvem para uma direção de arte", () => {
  it("todo rótulo de nicho resolve uma categoria, e as exceções são declaradas", () => {
    const fellBack = NICHES.filter(
      (niche) => resolveCategoryId(niche.label) === FALLBACK_CATEGORY_ID,
    ).map((niche) => niche.id);

    expect(fellBack.sort()).toEqual([...ALLOWED_FALLBACK].sort());
  });

  it("nenhuma exceção declarada sobra sem nicho", () => {
    const ids = new Set(NICHES.map((niche) => niche.id));
    for (const allowed of ALLOWED_FALLBACK) {
      expect(ids, allowed).toContain(allowed);
    }
  });

  it("os nichos mais distantes do genérico caem na categoria certa", () => {
    // Spot checks that would still pass the count above if the resolver started
    // matching everything onto a single wrong category.
    const expected: Record<string, string> = {
      barbearia: "beauty",
      pizzaria: "food",
      odontologia: "health",
      veterinaria: "pet",
      advocacia: "professional",
      hotel: "tourism",
      imobiliaria: "realestate",
      academia: "fitness",
      mecanica: "auto",
      escola: "education",
    };
    for (const [id, categoryId] of Object.entries(expected)) {
      const niche = NICHES.find((item) => item.id === id);
      expect(niche, id).toBeDefined();
      expect(resolveCategoryId(niche!.label), id).toBe(categoryId);
    }
  });
});
