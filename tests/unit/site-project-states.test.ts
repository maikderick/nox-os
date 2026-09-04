import { describe, expect, it } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import {
  allowedTransitionsFor,
  canTransition,
  findTransition,
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
    // The rule lives in the transition table, so it keeps holding while the
    // stage itself is withheld for want of a deployment flow.
    expect(findTransition("APROVADO", "PUBLICANDO")?.permission).toBe("publish:approve");
    expect(permissionsForRole("OPERADOR")).not.toContain("publish:approve");
    expect(permissionsForRole("ADMIN")).toContain("publish:approve");
  });

  it("withholds publishing from everyone until the deployment flow exists", () => {
    for (const role of ["OPERADOR", "ADMIN", "OWNER"] as const) {
      const targets = allowedTransitionsFor("APROVADO", permissionsForRole(role)).map(
        (transition) => transition.to,
      );
      expect(targets).not.toContain("PUBLICANDO");
    }
  });

  it("keeps every draft and preview private", () => {
    for (const state of SITE_PROJECT_STATES) {
      expect(isPublicState(state)).toBe(state === "PUBLICADO");
    }
    expect(hasInternalPreview("PREVIA_PRONTA")).toBe(true);
    expect(hasInternalPreview("RASCUNHO")).toBe(false);
  });
});
