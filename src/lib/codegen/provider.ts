import type { SiteBrief } from "@/lib/site-factory/brief-schema";

export type CodeGenerationRequest = {
  projectId: string;
  projectName: string;
  briefVersionId: string;
  brief: SiteBrief;
};

export type CodeGenerationResult = {
  providerRunId: string | null;
  status: "PENDENTE" | "EXECUTANDO" | "CONCLUIDO";
  message: string;
  metadata?: Record<string, unknown>;
};

export interface CodeGenerationProvider {
  readonly id: string;
  readonly label: string;
  generate(request: CodeGenerationRequest): Promise<CodeGenerationResult>;
}
