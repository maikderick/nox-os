import { describe, expect, it } from "vitest";

import { siteBriefSchema } from "../../src/lib/site-factory/brief-schema";
import { briefFactsHash } from "../../src/lib/site-factory/brief-service";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-08-25T12:00:00.000Z" };
}

/** The stamp the frozen fixture below was written with. Never change it. */
function fact2(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-08-25T12:00:00.000-03:00" };
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

/**
 * A v2 brief exactly as it was written to the database before `about` existed.
 * Frozen: editing any value here invalidates the hash the next test asserts.
 */
const LEGACY_V2_BRIEF = {
  schemaVersion: 2,
  businessName: fact2("Oficina Demonstração NOX"),
  sector: fact2("Manutenção residencial"),
  city: fact2("São Paulo"),
  objective: fact2("Apresentar os serviços de manutenção residencial e receber contatos."),
  audience: fact2("Moradores e pequenos comércios da região central."),
  positioning: fact2("Serviços de manutenção residencial executados por equipe própria."),
  differentiators: [fact2("Atendimento agendado")],
  desiredSections: ["inicio", "sobre", "servicos", "contato"],
  visualDirection: fact2("Visual limpo, com foco em leitura e contraste alto."),
  notes: null,
  services: [],
  publicContact: {
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    coordinates: null,
    openingHours: null,
    socialLinks: [],
  },
  metaDescription: null,
};

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

  it("does not change the fingerprint of a v2 brief stored before `about` existed", () => {
    /*
     * The gate this protects: `briefFactsHash` hashes the **parsed** brief, and
     * `assertProvisioningEligible` recomputes it from the stored JSON on every
     * provisioning step. A `.default(null)` on a new optional field makes the
     * parse *insert* the key, changing the hash of every row already written —
     * and the refusal the operator then reads is `BRIEFING_ADULTERADO`, the
     * system accusing them of tampering with a briefing nobody touched.
     *
     * The literal below was computed once against the schema at `main`
     * 7f74852, before `about` existed, and is frozen here on purpose. The
     * provisioning fixtures recompute the hash under the current schema, so
     * they can never catch this; only a hash written down can.
     */
    const parsed = siteBriefSchema.parse(JSON.parse(JSON.stringify(LEGACY_V2_BRIEF)));

    expect(JSON.stringify(parsed)).not.toContain('"about"');
    expect(briefFactsHash(parsed)).toBe(
      "189a0debe52c457b34b190f90c11b34e23b2f858caea0f0a1e7a42d3e5c2e399",
    );
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
    // Absent, not null. `.optional()` without a `.default()` leaves the key
    // out entirely, which is what keeps the stored fingerprint intact — see
    // the frozen-hash case above. Consumers read `about ?? null`.
    expect(parsed.about).toBeUndefined();
    expect("about" in parsed).toBe(false);
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
