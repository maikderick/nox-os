import { describe, expect, it } from "vitest";

import { siteBriefSchema } from "../../src/lib/site-factory/brief-schema";
import { briefFactsHash } from "../../src/lib/site-factory/brief-service";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-08-25T12:00:00.000Z" };
}

function validBrief() {
  return {
    schemaVersion: 1 as const,
    businessName: fact("Padaria Aurora"),
    sector: fact("Padaria"),
    city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas que procuram produtos de padaria na região."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    services: [fact("Pães artesanais")],
    differentiators: [],
    desiredSections: ["Início", "Sobre", "Contato"],
    visualDirection: fact("Visual acolhedor, contemporâneo e legível."),
    notes: null,
  };
}

describe("versioned site brief", () => {
  it("accepts facts only when source and confirmation time are present", () => {
    expect(siteBriefSchema.safeParse(validBrief()).success).toBe(true);
    const missingConfirmation = validBrief() as Record<string, unknown>;
    missingConfirmation.objective = { value: "Criar o site", source: "OPERADOR" };
    expect(siteBriefSchema.safeParse(missingConfirmation).success).toBe(false);
  });

  it("rejects unsupported claims in free-form copy", () => {
    const brief = validBrief();
    brief.positioning = fact("A melhor padaria da região com 20% de desconto.");
    const result = siteBriefSchema.safeParse(brief);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/não sustentada/i);
    }
  });

  it("keeps parsing a stored v2 brief written before the presentation text existed", () => {
    // The field is nullable with a default precisely so no stored brief has to
    // be rewritten: a brief that predates it simply has no presentation text.
    const stored = {
      ...validBrief(),
      schemaVersion: 2 as const,
      services: [],
      publicContact: {},
      metaDescription: null,
    };
    const parsed = siteBriefSchema.parse(stored);
    expect(parsed.schemaVersion).toBe(2);
    if (parsed.schemaVersion !== 2) return;
    expect(parsed.about).toBeNull();
  });

  it("applies the claim rules to the presentation text, which is customer copy", () => {
    // `about` is the one narrative field a visitor reads, so it is held to the
    // same rules as everything else that reaches a page.
    const brief = {
      ...validBrief(),
      schemaVersion: 2 as const,
      services: [],
      publicContact: {},
      metaDescription: null,
      about: fact("A melhor padaria da região, desde 1998."),
    };
    const result = siteBriefSchema.safeParse(brief);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "about")).toBe(true);
    }
  });

  it("produces a stable integrity hash independent of object key order", () => {
    const parsed = siteBriefSchema.parse(validBrief());
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    expect(briefFactsHash(parsed)).toBe(
      briefFactsHash(siteBriefSchema.parse(reordered)),
    );
  });
});
