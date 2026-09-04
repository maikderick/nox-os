import { describe, expect, it } from "vitest";

import {
  CLAIM_RULE_IDS,
  findClaimRisks,
  normalizeForMatching,
} from "../../src/lib/content-integrity";

describe("shared content integrity", () => {
  it("normalizes accents, casing and whitespace for matching", () => {
    expect(normalizeForMatching("  A MELHOR  Padária\n da Região ")).toBe(
      "a melhor padaria da regiao",
    );
  });

  it("reports unsupported commercial and reputation claims with their field", () => {
    const risks = findClaimRisks([
      { field: "headline", value: "A melhor clínica da região" },
      { field: "offer", value: "Ganhe 20% de desconto" },
      { field: "socialProof", value: "Mais de 500 clientes atendidos" },
    ]);

    expect(risks.map(({ rule, field }) => ({ rule, field }))).toEqual(
      expect.arrayContaining([
        { rule: "superlativo", field: "headline" },
        { rule: "preco", field: "offer" },
        { rule: "experiencia", field: "socialProof" },
      ]),
    );
  });

  it("allows only rules explicitly confirmed by the caller", () => {
    const entries = [{ field: "contact", value: "Contato: (85) 99999-9999" }];
    expect(findClaimRisks(entries).map((risk) => risk.rule)).toContain("contato");
    expect(findClaimRisks(entries, { allow: ["contato"] })).toEqual([]);
  });

  it("exports stable unique rule identifiers", () => {
    expect(new Set(CLAIM_RULE_IDS).size).toBe(CLAIM_RULE_IDS.length);
    expect(CLAIM_RULE_IDS).toContain("garantia");
  });
});
