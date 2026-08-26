import { describe, expect, it } from "vitest";

import { IntegrationDisabledError } from "../../src/lib/providers/errors";
import { createFakeGitRepositoryProvider } from "../../src/lib/providers/fake/fake-git";
import { createFakeHostingProvider } from "../../src/lib/providers/fake/fake-hosting";
import { FakeWorld, fakeCredentials } from "../../src/lib/providers/fake/fake-world";
import { getGitRepositoryProvider, getHostingProvider } from "../../src/lib/providers/registry";
import type { GitHubAppRole } from "../../src/lib/providers/types";
import { runProviderContract } from "../contract/provider-contract";

const world = new FakeWorld();
const credentials = fakeCredentials(world);

runProviderContract({
  name: "FALSO",
  reset: () => world.reset(),
  git: () => createFakeGitRepositoryProvider({ world, credentials }),
  hosting: () => createFakeHostingProvider({ world }),
  credentialCalls: () => world.credentialCalls as GitHubAppRole[],
  hideFromHosting: (owner, name) => world.hideFromHosting(owner, name),
});

describe("provider registry", () => {
  it("refuses every operation while the integration is off", async () => {
    const git = getGitRepositoryProvider("DESLIGADO");
    const hosting = getHostingProvider("DESLIGADO");

    expect(await git.isConfigured()).toBe(false);
    expect(await hosting.isConfigured()).toBe(false);

    await expect(
      git.createFromTemplate({
        owner: "o",
        name: "n",
        templateOwner: "t",
        templateRepo: "r",
      }),
    ).rejects.toBeInstanceOf(IntegrationDisabledError);
    await expect(git.getRepository({ owner: "o", name: "n" })).rejects.toMatchObject({
      code: "INTEGRACAO_DESLIGADA",
    });
    await expect(
      hosting.createProject({
        name: "n",
        repo: { owner: "o", name: "n", externalId: null, url: null, defaultBranch: "main" },
      }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });
  });

  it("does not hand out a LIVE provider in this phase", () => {
    expect(() => getGitRepositoryProvider("LIVE")).toThrow(/LIVE/);
    expect(() => getHostingProvider("LIVE")).toThrow(/LIVE/);
  });

  it("does not hand out a SANDBOX provider before its fixtures exist", () => {
    expect(() => getGitRepositoryProvider("SANDBOX")).toThrow(/SANDBOX/);
  });

  it("serves the fake for FALSO", () => {
    expect(getGitRepositoryProvider("FALSO").mode).toBe("FALSO");
    expect(getHostingProvider("FALSO").mode).toBe("FALSO");
  });
});
