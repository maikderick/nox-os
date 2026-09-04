import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFakeGitRepositoryProvider } from "../fake/fake-git";
import { createFakeHostingProvider } from "../fake/fake-hosting";
import type { FakeWorld } from "../fake/fake-world";
import type { GitRepositoryProvider, HostingProvider } from "../ports";
import type { GitHubCredentials } from "../types";

import {
  mapGitHubCommit,
  mapGitHubRepository,
  mapVercelDeployment,
  mapGitHubCheckRuns,
  mapVercelProject,
  type GitHubCheckRunsPayload,
  type GitHubCommitPayload,
  type GitHubRepositoryPayload,
  type VercelDeploymentPayload,
  type VercelProjectPayload,
} from "./mappers";

const fixturesDir = resolve(process.cwd(), "fixtures/sandbox");

function readFixture<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, ...segments), "utf8")) as T;
}

/**
 * Replays recorded responses through the real mappers.
 *
 * State is still simulated — a recorded exchange cannot answer a question it
 * was never asked. What comes from the fixtures is the *shape*: identity fields
 * are substituted from the request, exactly as a recorded interaction would be
 * replayed against a different repository name.
 */
export function createSandboxGitRepositoryProvider(
  options: { world?: FakeWorld; credentials?: GitHubCredentials } = {},
): GitRepositoryProvider {
  const fake = createFakeGitRepositoryProvider(options);

  return {
    id: "github",
    mode: "SANDBOX",

    async isConfigured() {
      return true;
    },

    async createFromTemplate(input) {
      await fake.createFromTemplate(input);

      const payload = readFixture<GitHubRepositoryPayload>("github", "repository.json");
      return mapGitHubRepository({
        ...payload,
        name: input.name,
        owner: { login: input.owner },
        html_url: `https://github.com/${input.owner}/${input.name}`,
        template_repository: {
          name: input.templateRepo,
          owner: { login: input.templateOwner },
        },
      });
    },

    async protectDefaultBranch(input) {
      return fake.protectDefaultBranch(input);
    },

    async getRepository(input) {
      const existing = await fake.getRepository(input);
      if (!existing) return null;

      const payload = readFixture<GitHubRepositoryPayload>("github", "repository.json");
      return mapGitHubRepository({
        ...payload,
        name: input.name,
        owner: { login: input.owner },
        html_url: `https://github.com/${input.owner}/${input.name}`,
        template_repository: existing.templateRepository
          ? {
              name: existing.templateRepository.name,
              owner: { login: existing.templateRepository.owner },
            }
          : null,
      });
    },

    async commitFiles(input) {
      const simulated = await fake.commitFiles(input);

      const payload = readFixture<GitHubCommitPayload>("github", "commit.json");
      return mapGitHubCommit({
        ...payload,
        sha: simulated.sha,
        html_url: `https://github.com/${input.repo.owner}/${input.repo.name}/commit/${simulated.sha}`,
      });
    },

    async listChecks(input) {
      const simulated = await fake.listChecks(input);
      // Nothing declared means nothing reported. Reading the fixture here would
      // have every sandbox commit come back green before CI had run.
      if (simulated.length === 0) return [];

      const payload = readFixture<GitHubCheckRunsPayload>("github", "check-runs.json");
      const shape = payload.check_runs[0];

      // The recorded payload supplies the shape — the two-field status GitHub
      // actually uses — and the simulated world supplies which checks exist and
      // how they went.
      return mapGitHubCheckRuns({
        total_count: simulated.length,
        check_runs: simulated.map((check, index) => ({
          ...shape,
          id: shape.id + index,
          name: check.name,
          head_sha: input.commitSha,
          status: FINISHED_CHECKS.has(check.status) ? "completed" : check.status,
          conclusion: FINISHED_CHECKS.has(check.status) ? check.status : null,
        })),
      });
    },
  };
}

/** Words the fake uses that mean the check is over. Everything else is running. */
const FINISHED_CHECKS = new Set(["success", "failure", "cancelled", "timed_out", "neutral"]);

export function createSandboxHostingProvider(
  options: { world?: FakeWorld } = {},
): HostingProvider {
  const fake = createFakeHostingProvider(options);

  return {
    id: "vercel",
    mode: "SANDBOX",

    async isConfigured() {
      return true;
    },

    async canAccessRepository(input) {
      return fake.canAccessRepository(input);
    },

    async getProject(input) {
      const existing = await fake.getProject(input);
      if (!existing) return null;

      const payload = readFixture<VercelProjectPayload>("vercel", "project.json");
      return mapVercelProject({
        ...payload,
        name: input.name,
        // The link is what a resume checks, so it has to reflect the project
        // that actually exists rather than the fixture's example.
        link: existing.linkedRepository
          ? { org: existing.linkedRepository.owner, repo: existing.linkedRepository.name }
          : null,
        targets: { production: { alias: [`${input.name}.vercel.app`] } },
      });
    },

    async createProject(input) {
      await fake.createProject(input);

      const payload = readFixture<VercelProjectPayload>("vercel", "project.json");
      return mapVercelProject({
        ...payload,
        name: input.name,
        link: { org: input.repo.owner, repo: input.repo.name },
        targets: { production: { alias: [`${input.name}.vercel.app`] } },
      });
    },

    async setEnvironmentVariables(input) {
      return fake.setEnvironmentVariables(input);
    },

    async listDeployments(input) {
      const simulated = await fake.listDeployments(input);
      const payload = readFixture<VercelDeploymentPayload>("vercel", "deployment.json");

      return simulated.map((deployment) =>
        mapVercelDeployment({
          ...payload,
          uid: deployment.externalId,
          url: `${input.project.name}-${(deployment.commitSha ?? "").slice(0, 8)}.vercel.app`,
          readyState: deployment.state,
          createdAt: Date.parse(deployment.createdAt),
          meta: { githubCommitSha: deployment.commitSha ?? undefined },
        }),
      );
    },
  };
}
