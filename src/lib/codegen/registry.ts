import { manualCodeGenerationProvider } from "./manual-provider";
import type { CodeGenerationProvider } from "./provider";

const PROVIDERS = new Map<string, CodeGenerationProvider>([
  [manualCodeGenerationProvider.id, manualCodeGenerationProvider],
]);

export function getCodeGenerationProvider(id: string): CodeGenerationProvider {
  const provider = PROVIDERS.get(id);
  if (!provider) throw new Error(`Provedor de geração desconhecido: ${id}`);
  return provider;
}

export function listCodeGenerationProviders(): Array<{ id: string; label: string }> {
  return [...PROVIDERS.values()].map(({ id, label }) => ({ id, label }));
}
