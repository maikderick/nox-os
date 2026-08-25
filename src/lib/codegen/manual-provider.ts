import type {
  CodeGenerationProvider,
  CodeGenerationResult,
} from "./provider";

/** Phase-one provider: records a handoff without calling an external service. */
export const manualCodeGenerationProvider: CodeGenerationProvider = {
  id: "manual",
  label: "Geração manual",
  async generate(): Promise<CodeGenerationResult> {
    return {
      providerRunId: null,
      status: "PENDENTE",
      message: "Projeto preparado para geração manual.",
    };
  },
};
