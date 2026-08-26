import type { IntegrationMode } from "@/lib/integrations/modes";

import { IntegrationDisabledError, IntegrationModeUnsupportedError } from "./errors";
import { createFakeGitRepositoryProvider } from "./fake/fake-git";
import { createFakeHostingProvider } from "./fake/fake-hosting";
import {
  createSandboxGitRepositoryProvider,
  createSandboxHostingProvider,
} from "./sandbox/sandbox-providers";
import type { GitRepositoryProvider, HostingProvider } from "./ports";

/**
 * A provider that refuses everything, with the same message every time.
 *
 * `DESLIGADO` is the default, so this is what most installations get. Refusing
 * here — rather than returning a no-op — means a disabled integration can never
 * be mistaken for a successful one.
 */
function disabledGitProvider(): GitRepositoryProvider {
  const refuse = (): never => {
    throw new IntegrationDisabledError("github");
  };
  return {
    id: "github",
    mode: "DESLIGADO",
    isConfigured: async () => false,
    createFromTemplate: async () => refuse(),
    protectDefaultBranch: async () => refuse(),
    getRepository: async () => refuse(),
    commitFiles: async () => refuse(),
  };
}

function disabledHostingProvider(): HostingProvider {
  const refuse = (): never => {
    throw new IntegrationDisabledError("vercel");
  };
  return {
    id: "vercel",
    mode: "DESLIGADO",
    isConfigured: async () => false,
    canAccessRepository: async () => refuse(),
    createProject: async () => refuse(),
    setEnvironmentVariables: async () => refuse(),
    listDeployments: async () => refuse(),
  };
}

export function getGitRepositoryProvider(mode: IntegrationMode): GitRepositoryProvider {
  switch (mode) {
    case "DESLIGADO":
      return disabledGitProvider();
    case "FALSO":
      return createFakeGitRepositoryProvider();
    case "SANDBOX":
      return createSandboxGitRepositoryProvider();
    default:
      // LIVE is a separate, approved decision, one provider at a time.
      throw new IntegrationModeUnsupportedError("github", mode);
  }
}

export function getHostingProvider(mode: IntegrationMode): HostingProvider {
  switch (mode) {
    case "DESLIGADO":
      return disabledHostingProvider();
    case "FALSO":
      return createFakeHostingProvider();
    case "SANDBOX":
      return createSandboxHostingProvider();
    default:
      throw new IntegrationModeUnsupportedError("vercel", mode);
  }
}
