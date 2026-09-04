import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeWorld, fakeCredentials } from "../../src/lib/providers/fake/fake-world";
import {
  mapGitHubRepository,
  mapVercelDeployment,
  mapVercelProject,
} from "../../src/lib/providers/sandbox/mappers";
import {
  createSandboxGitRepositoryProvider,
  createSandboxHostingProvider,
} from "../../src/lib/providers/sandbox/sandbox-providers";
import { getGitRepositoryProvider, getHostingProvider } from "../../src/lib/providers/registry";
import type { GitHubAppRole } from "../../src/lib/providers/types";
import { runProviderContract } from "../contract/provider-contract";

const world = new FakeWorld();
const credentials = fakeCredentials(world);

// The same assertions that run against the fake. A behaviour only one of them
// has shows up here as a failure instead of on the first live call.
runProviderContract({
  name: "SANDBOX",
  reset: () => world.reset(),
  git: () => createSandboxGitRepositoryProvider({ world, credentials }),
  hosting: () => createSandboxHostingProvider({ world }),
  credentialCalls: () => world.credentialCalls as GitHubAppRole[],
  hideFromHosting: (owner, name) => world.hideFromHosting(owner, name),
});

const fixturesDir = resolve(process.cwd(), "fixtures/sandbox");

function fixtureFiles(dir = fixturesDir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    return statSync(full).isDirectory() ? fixtureFiles(full) : [full];
  });
}

describe("sandbox fixtures", () => {
  const files = fixtureFiles();

  it("exist for both providers", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("carries nothing that looks like a secret: %s", (file) => {
    const content = readFileSync(file, "utf8");

    // A fixture is committed and shared. Anything token-shaped in one is a leak
    // that survives every future rotation of the real credential.
    expect(content).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
    expect(content).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(content).not.toMatch(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i);
    expect(content).not.toMatch(/"(authorization|cookie|set-cookie)"\s*:/i);
    expect(content).not.toMatch(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/);
  });
});

describe("reading what the providers really return", () => {
  it("turns a numeric GitHub id into the text the database stores", () => {
    const mapped = mapGitHubRepository({
      id: 862341097,
      name: "site-exemplo",
      owner: { login: "nox-sites-exemplo" },
      html_url: "https://github.com/nox-sites-exemplo/site-exemplo",
      default_branch: "main",
    });

    expect(mapped.externalId).toBe("862341097");
    expect(typeof mapped.externalId).toBe("string");
  });

  it("adds the scheme Vercel omits from a hostname", () => {
    const project = mapVercelProject({
      id: "prj_1",
      name: "site-exemplo",
      targets: { production: { alias: ["site-exemplo.vercel.app"] } },
    });
    expect(project.url).toBe("https://site-exemplo.vercel.app");

    const withoutAlias = mapVercelProject({ id: "prj_1", name: "site-exemplo" });
    expect(withoutAlias.url).toBeNull();
  });

  it("reads readyState and epoch milliseconds, not state and an ISO string", () => {
    const deployment = mapVercelDeployment({
      uid: "dpl_1",
      url: "site-exemplo-abc.vercel.app",
      readyState: "BUILDING",
      createdAt: 1787000000000,
      meta: { githubCommitSha: "abc123" },
    });

    expect(deployment.state).toBe("BUILDING");
    expect(deployment.url).toBe("https://site-exemplo-abc.vercel.app");
    expect(deployment.commitSha).toBe("abc123");
    expect(deployment.createdAt).toBe(new Date(1787000000000).toISOString());
  });

  it("reports a missing commit as null instead of inventing one", () => {
    const deployment = mapVercelDeployment({
      uid: "dpl_1",
      url: "x.vercel.app",
      readyState: "ERROR",
      createdAt: 1787000000000,
    });
    expect(deployment.commitSha).toBeNull();
  });
});

describe("registry", () => {
  it("serves the sandbox now that its fixtures exist", () => {
    expect(getGitRepositoryProvider("SANDBOX").mode).toBe("SANDBOX");
    expect(getHostingProvider("SANDBOX").mode).toBe("SANDBOX");
  });

  it("still refuses LIVE", () => {
    expect(() => getGitRepositoryProvider("LIVE")).toThrow(/LIVE/);
    expect(() => getHostingProvider("LIVE")).toThrow(/LIVE/);
  });
});
