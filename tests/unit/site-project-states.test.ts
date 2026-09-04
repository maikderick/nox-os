import { describe, expect, it } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import {
  allowedTransitionsFor,
  canTransition,
  findTransition,
  hasInternalPreview,
  isPublicState,
  SITE_PROJECT_STATE_LABELS,
  SITE_PROJECT_STATES,
  transitionsFrom,
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

  it("lets a person generate the site, without any agent", () => {
    // The renderer computes the whole site from the confirmed brief, so
    // reaching `PREVIA_PRONTA` is a decision, not a run. Without this
    // transition the only door is the generation pipeline, and with every
    // provider `DESLIGADO` no project ever gets through it.
    const release = findTransition("BRIEFING_PRONTO", "PREVIA_PRONTA");
    expect(release?.permission).toBe("project:write");
    expect(release?.label).toBe("Gerar site");

    const operator = permissionsForRole("OPERADOR");
    expect(operator).toContain("project:write");
    expect(allowedTransitionsFor("BRIEFING_PRONTO", operator).map((t) => t.to)).toContain(
      "PREVIA_PRONTA",
    );
    // A reader may look, never move.
    expect(allowedTransitionsFor("BRIEFING_PRONTO", permissionsForRole("LEITOR"))).toEqual([]);
  });

  it("lets the briefing be reopened from a generated site", () => {
    const reopen = findTransition("PREVIA_PRONTA", "BRIEFING_PRONTO");
    expect(reopen?.permission).toBe("brief:write");
    expect(allowedTransitionsFor("PREVIA_PRONTA", permissionsForRole("OPERADOR")).map((t) => t.to))
      .toContain("BRIEFING_PRONTO");
  });

  it("keeps the agent path separate, and separately named", () => {
    const agent = findTransition("BRIEFING_PRONTO", "GERANDO");
    expect(agent?.permission).toBe("generation:run");
    expect(agent?.label).toBe("Gerar com agente");

    // Two actions offered from the same state that read alike are one action
    // as far as the operator is concerned.
    const labels = transitionsFrom("BRIEFING_PRONTO").map((transition) => transition.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("still refuses every jump", () => {
    expect(canTransition("BRIEFING_PRONTO", "APROVADO")).toBe(false);
    expect(canTransition("BRIEFING_PRONTO", "PUBLICADO")).toBe(false);
    expect(canTransition("BRIEFING_PRONTO", "PUBLICANDO")).toBe(false);
    expect(canTransition("RASCUNHO", "PREVIA_PRONTA")).toBe(false);
    expect(findTransition("PUBLICANDO", "PUBLICADO")?.permission).toBe(null);
  });

  it("nomeia cada estado pelo que o operador pode fazer", () => {
    // The enum values belong to the domain; these strings are the operator's,
    // and no page may retype them.
    expect(SITE_PROJECT_STATE_LABELS.BRIEFING_PRONTO).toBe("Pronto para gerar");
    expect(SITE_PROJECT_STATE_LABELS.PREVIA_PRONTA).toBe("Site gerado");
    expect(SITE_PROJECT_STATE_LABELS.GERANDO).toBe("Construindo repositório");
  });

  it("keeps every draft and preview private", () => {
    for (const state of SITE_PROJECT_STATES) {
      expect(isPublicState(state)).toBe(state === "PUBLICADO");
    }
    expect(hasInternalPreview("PREVIA_PRONTA")).toBe(true);
    expect(hasInternalPreview("RASCUNHO")).toBe(false);
  });
});
