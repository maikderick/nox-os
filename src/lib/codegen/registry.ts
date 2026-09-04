import type { IntegrationMode } from "@/lib/integrations/modes";
import { IntegrationDisabledError, IntegrationModeUnsupportedError } from "@/lib/providers/errors";

import { createFakeCodeGenerationProvider } from "./fake/fake-agent";
import {
  AgentReconciliationUnsupportedError,
  type AgentRunRef,
  type CodeGenerationProvider,
} from "./provider";
import { createSandboxCodeGenerationProvider } from "./sandbox/sandbox-agent";

/**
 * Which agent answers, decided by the mode and by nothing else.
 *
 * The registry used to be keyed by a provider **id** passed in from a column,
 * which meant the choice of who gets called was data. It is now the same shape
 * as the git and hosting registries: the organization's mode decides, `LIVE`
 * throws, and the default is a provider that refuses everything.
 */

/**
 * A provider that refuses everything, with the same message every time.
 *
 * `DESLIGADO` is the default, so this is what most installations get. Refusing
 * — rather than returning a no-op — means a disabled integration can never be
 * mistaken for a successful one.
 */
function disabledAgentProvider(): CodeGenerationProvider {
  const refuse = (): never => {
    throw new IntegrationDisabledError("cursor");
  };
  return {
    id: "cursor",
    mode: "DESLIGADO",
    capabilities: { idempotentStart: false, reconcileByKey: false },
    isConfigured: async () => false,
    start: async () => refuse(),
    poll: async () => refuse(),
    // Cancel refuses too. A disabled provider has nothing to cancel, and a
    // silent no-op here would let a cleanup path report success for a provider
    // it never spoke to.
    cancel: async () => refuse(),
    findRunByKey: async (): Promise<AgentRunRef | null> => {
      // Not a refusal about being disabled — the honest answer is that this
      // provider cannot look a key up, and null would claim it looked.
      throw new AgentReconciliationUnsupportedError("cursor");
    },
  };
}

export function getCodeGenerationProvider(mode: IntegrationMode): CodeGenerationProvider {
  switch (mode) {
    case "DESLIGADO":
      return disabledAgentProvider();
    case "FALSO":
      return createFakeCodeGenerationProvider();
    case "SANDBOX":
      return createSandboxCodeGenerationProvider();
    default:
      // LIVE is a separate, approved decision, one provider at a time.
      throw new IntegrationModeUnsupportedError("cursor", mode);
  }
}
