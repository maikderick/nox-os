import { describe, expect, it } from "vitest";

import { getCodeGenerationProvider, listCodeGenerationProviders } from "../../src/lib/codegen/registry";
import { siteBriefSchema } from "../../src/lib/site-factory/brief-schema";

const fact = (value: string) => ({
  value,
  source: "OPERADOR" as const,
  confirmedAt: "2026-08-25T12:00:00.000Z",
});

describe("code generation provider registry", () => {
  it("registers the manual provider without external calls or credentials", async () => {
    const provider = getCodeGenerationProvider("manual");
    const result = await provider.generate({
      projectId: "project-1",
      projectName: "Site Padaria Aurora",
      briefVersionId: "brief-1",
      brief: siteBriefSchema.parse({
        businessName: fact("Padaria Aurora"),
        sector: fact("Padaria"),
        objective: fact("Apresentar o negócio."),
        audience: fact("Pessoas da região."),
        positioning: fact("Informações claras sobre o negócio."),
        desiredSections: ["Início", "Contato"],
        visualDirection: fact("Visual contemporâneo e legível."),
      }),
    });
    expect(result).toMatchObject({ status: "PENDENTE", providerRunId: null });
    expect(listCodeGenerationProviders()).toEqual([{ id: "manual", label: "Geração manual" }]);
  });

  it("refuses unknown providers", () => {
    expect(() => getCodeGenerationProvider("cursor")).toThrow(/desconhecido/i);
  });
});
