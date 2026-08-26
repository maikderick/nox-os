import { describe, expect, it } from "vitest";

import {
  INTEGRATION_MODES,
  MODES_AVAILABLE,
  environmentForcesDisabled,
  isModeAvailable,
  resolveIntegrationMode,
} from "../../src/lib/integrations/modes";

describe("integration modes", () => {
  it("starts every provider off", () => {
    expect(resolveIntegrationMode(undefined, {})).toBe("DESLIGADO");
    expect(resolveIntegrationMode(null, {})).toBe("DESLIGADO");
  });

  it("does not offer LIVE in this phase", () => {
    expect(INTEGRATION_MODES).toContain("LIVE");
    expect(MODES_AVAILABLE).not.toContain("LIVE");
    expect(isModeAvailable("LIVE")).toBe(false);
  });

  it("treats a stored LIVE as off rather than as permission", () => {
    expect(resolveIntegrationMode("LIVE", {})).toBe("DESLIGADO");
  });

  it("falls back to off for anything unrecognised", () => {
    expect(resolveIntegrationMode("QUASE_LIGADO", {})).toBe("DESLIGADO");
    expect(resolveIntegrationMode("", {})).toBe("DESLIGADO");
  });

  it("lets the environment override the database", () => {
    expect(environmentForcesDisabled({ NOX_INTEGRATIONS: "disabled" })).toBe(true);
    expect(environmentForcesDisabled({ NOX_INTEGRATIONS: "DISABLED" })).toBe(true);
    expect(environmentForcesDisabled({})).toBe(false);

    expect(resolveIntegrationMode("SANDBOX", { NOX_INTEGRATIONS: "disabled" })).toBe("DESLIGADO");
    expect(resolveIntegrationMode("SANDBOX", {})).toBe("SANDBOX");
  });
});
