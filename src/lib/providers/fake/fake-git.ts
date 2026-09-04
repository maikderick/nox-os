import {
  ProviderResourceConflictError,
  ProviderResourceNotFoundError,
} from "../errors";
import type { GitRepositoryProvider } from "../ports";
import type { CommitRef, FileChange, GitHubCredentials, RepoRef } from "../types";

import {
  deterministicId,
  deterministicSha,
  repoKey,
  sharedFakeWorld,
  fakeCredentials,
  type FakeWorld,
} from "./fake-world";

function toRef(repo: {
  owner: string;
  name: string;
  externalId: string;
  url: string;
  defaultBranch: string;
  templateRepository: { owner: string; name: string } | null;
}): RepoRef {
  return {
    owner: repo.owner,
    name: repo.name,
    externalId: repo.externalId,
    url: repo.url,
    defaultBranch: repo.defaultBranch,
    templateRepository: repo.templateRepository,
  };
}

/**
 * An in-memory GitHub. It answers the same way every time and never opens a
 * socket, which is what makes it usable as the default for development and the
 * baseline for the contract suite.
 */
export function createFakeGitRepositoryProvider(options: {
  world?: FakeWorld;
  credentials?: GitHubCredentials;
} = {}): GitRepositoryProvider {
  const world = options.world ?? sharedFakeWorld;
  const credentials = options.credentials ?? fakeCredentials(world);

  return {
    id: "github",
    mode: "FALSO",

    async isConfigured() {
      return true;
    },

    async createFromTemplate(input) {
      // Privileged: this is the one operation that brings a repository into
      // existence, and it is the only reason the Provisioner App exists.
      await credentials.forProvisioner();

      const key = repoKey(input.owner, input.name);
      if (world.repositories.has(key)) {
        throw new ProviderResourceConflictError(`O repositório ${input.owner}/${input.name}`);
      }

      const repo = {
        owner: input.owner,
        name: input.name,
        externalId: deterministicId("repo", input.owner, input.name),
        url: `https://github.example/${input.owner}/${input.name}`,
        defaultBranch: "main",
        // The host remembers what a repository was generated from; so does this.
        templateRepository: { owner: input.templateOwner, name: input.templateRepo },
        protectedChecks: null as string[] | null,
        files: new Map<string, string>([
          [".github/workflows/ci.yml", `# copiado de ${input.templateOwner}/${input.templateRepo}`],
        ]),
        commits: [] as Array<{ sha: string; message: string; paths: string[] }>,
        checks: new Map<string, Array<{ name: string; status: string; externalId: string | null }>>(),
      };
      world.repositories.set(key, repo);
      return toRef(repo);
    },

    async protectDefaultBranch(input) {
      await credentials.forProvisioner();

      const repo = world.repositories.get(repoKey(input.repo.owner, input.repo.name));
      if (!repo) {
        throw new ProviderResourceNotFoundError(
          `O repositório ${input.repo.owner}/${input.repo.name}`,
        );
      }
      repo.protectedChecks = [...input.requiredChecks];
    },

    async getRepository(input) {
      await credentials.forReconciler();

      const repo = world.repositories.get(repoKey(input.owner, input.name));
      return repo ? toRef(repo) : null;
    },

    async commitFiles(input): Promise<CommitRef> {
      // Everyday work: the Reconciler can write content and read state, and can
      // neither create nor delete a repository.
      await credentials.forReconciler();

      const repo = world.repositories.get(repoKey(input.repo.owner, input.repo.name));
      if (!repo) {
        throw new ProviderResourceNotFoundError(
          `O repositório ${input.repo.owner}/${input.repo.name}`,
        );
      }

      const changed = input.files.filter(
        (file: FileChange) => repo.files.get(file.path) !== file.content,
      );

      // Committing identical content is a no-op that still reports the commit
      // the content already lives in — the caller must be able to repeat a step.
      if (changed.length === 0) {
        const last = repo.commits.at(-1);
        if (last) return { sha: last.sha, url: `${repo.url}/commit/${last.sha}` };
      }

      for (const file of input.files) repo.files.set(file.path, file.content);

      const sha = deterministicSha(
        repo.externalId,
        input.branch,
        ...input.files.map((file) => `${file.path}:${file.content}`),
      );
      repo.commits.push({
        sha,
        message: input.message,
        paths: input.files.map((file) => file.path),
      });

      return { sha, url: `${repo.url}/commit/${sha}` };
    },

    async listChecks(input) {
      // Everyday read, so the everyday App. A test asserts the privileged one
      // is never reached by this path.
      await credentials.forReconciler();

      const repo = world.repositories.get(repoKey(input.repo.owner, input.repo.name));
      if (!repo) {
        throw new ProviderResourceNotFoundError(
          `O repositório ${input.repo.owner}/${input.repo.name}`,
        );
      }

      // Absent by default. A fake that invented a green check would make the
      // one interesting case — nothing has reported yet — untestable.
      return (repo.checks.get(input.commitSha) ?? []).map((check) => ({
        name: check.name,
        status: check.status,
        externalId: check.externalId,
        commitSha: input.commitSha,
      }));
    },
  };
}
