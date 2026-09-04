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

  it("produces a stable integrity hash independent of object key order", () => {
    const parsed = siteBriefSchema.parse(validBrief());
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    expect(briefFactsHash(parsed)).toBe(
      briefFactsHash(siteBriefSchema.parse(reordered)),
    );
  });
});
