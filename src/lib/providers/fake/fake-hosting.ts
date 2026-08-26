import { ProviderResourceConflictError, ProviderResourceNotFoundError } from "../errors";
import type { HostingProvider } from "../ports";
import type { DeploymentInfo, ProjectRef } from "../types";

import { deterministicId, repoKey, sharedFakeWorld, type FakeWorld } from "./fake-world";

/**
 * An in-memory Vercel. Creating a project immediately produces one deployment
 * for the repository's current commit, which is what the real platform does and
 * what makes the reconciliation step meaningful under the fake.
 */
export function createFakeHostingProvider(
  options: { world?: FakeWorld } = {},
): HostingProvider {
  const world = options.world ?? sharedFakeWorld;

  return {
    id: "vercel",
    mode: "FALSO",

    async isConfigured() {
      return true;
    },

    async canAccessRepository(input) {
      return world.hostingCanSee(input.repo.owner, input.repo.name);
    },

    async createProject(input): Promise<ProjectRef> {
      if (world.projects.has(input.name)) {
        throw new ProviderResourceConflictError(`O projeto ${input.name}`);
      }

      const repo = world.repositories.get(repoKey(input.repo.owner, input.repo.name));
      if (!repo) {
        throw new ProviderResourceNotFoundError(
          `O repositório ${input.repo.owner}/${input.repo.name}`,
        );
      }

      const project = {
        externalId: deterministicId("prj", input.name),
        name: input.name,
        url: `https://${input.name}.vercel.example`,
        repoKey: repoKey(input.repo.owner, input.repo.name),
        envVars: new Map<string, { value: string; target: string }>(),
        deployments: [] as DeploymentInfo[],
      };
      world.projects.set(input.name, project);
      return { externalId: project.externalId, name: project.name, url: project.url };
    },

    async setEnvironmentVariables(input) {
      const project = world.projects.get(input.project.name);
      if (!project) throw new ProviderResourceNotFoundError(`O projeto ${input.project.name}`);
      for (const variable of input.vars) {
        project.envVars.set(variable.key, { value: variable.value, target: variable.target });
      }
    },

    async listDeployments(input): Promise<DeploymentInfo[]> {
      const project = world.projects.get(input.project.name);
      if (!project) throw new ProviderResourceNotFoundError(`O projeto ${input.project.name}`);

      // The platform builds whatever the repository currently holds. Deriving
      // the deployment from the repository's last commit keeps the fake honest
      // about the ordering: content is committed first, then a build exists.
      const repo = world.repositories.get(project.repoKey);
      const lastCommit = repo?.commits.at(-1);
      if (lastCommit && !project.deployments.some((d) => d.commitSha === lastCommit.sha)) {
        project.deployments.push({
          externalId: deterministicId("dpl", project.externalId, lastCommit.sha),
          state: "READY",
          url: `https://${project.name}-${lastCommit.sha.slice(0, 7)}.vercel.example`,
          commitSha: lastCommit.sha,
          // Derived from the commit, never from the clock: a fake that changes
          // between runs cannot be asserted on.
          createdAt: `2026-01-01T00:00:00.000Z`,
        });
      }

      return input.commitSha
        ? project.deployments.filter((d) => d.commitSha === input.commitSha)
        : [...project.deployments];
    },
  };
}
