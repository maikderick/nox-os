import { describe, expect, it } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import {
  allowedTransitionsFor,
  canTransition,
  hasInternalPreview,
  isPublicState,
  SITE_PROJECT_STATES,
} from "../../src/lib/site-factory/states";

describe("site project state machine", () => {
  it("contains the complete factory lifecycle", () => {
    expect(SITE_PROJECT_STATES).toEqual([
      "RASCUNHO",
      "BRIEFING_PRONTO",
      "GERANDO",
      "PREVIA_PRONTA",
      "EM_REVISAO",
      "APROVADO",
      "PUBLICANDO",
      "PUBLICADO",
      "FALHOU",
    ]);
  });

  it("accepts only declared transitions", () => {
    expect(canTransition("RASCUNHO", "BRIEFING_PRONTO")).toBe(true);
    expect(canTransition("RASCUNHO", "PUBLICADO")).toBe(false);
    expect(canTransition("GERANDO", "PREVIA_PRONTA")).toBe(true);
  });

  it("does not expose orchestrator callbacks as human actions", () => {
    const transitions = allowedTransitionsFor("GERANDO", permissionsForRole("OWNER"));
    expect(transitions).toEqual([]);
  });

  it("requires approval permission to publish", () => {
    const operatorTargets = allowedTransitionsFor(
      "APROVADO",
      permissionsForRole("OPERADOR"),
    ).map((transition) => transition.to);
    const adminTargets = allowedTransitionsFor(
      "APROVADO",
      permissionsForRole("ADMIN"),
    ).map((transition) => transition.to);

    expect(operatorTargets).not.toContain("PUBLICANDO");
    expect(adminTargets).toContain("PUBLICANDO");
  });

  it("keeps every draft and preview private", () => {
    for (const state of SITE_PROJECT_STATES) {
      expect(isPublicState(state)).toBe(state === "PUBLICADO");
    }
    expect(hasInternalPreview("PREVIA_PRONTA")).toBe(true);
    expect(hasInternalPreview("RASCUNHO")).toBe(false);
  });
});
