/**
 * The vocabulary the factory uses to talk to a git host and a hosting platform.
 *
 * Deliberately small: a method that exists is a method someone eventually calls,
 * so promotion to production and domain attachment are absent until the phase
 * that needs them.
 */

export type RepoRef = {
  owner: string;
  name: string;
  /** Null until the remote creation happens; synthetic under the fake. */
  externalId: string | null;
  url: string | null;
  defaultBranch: string;
};

export type CommitRef = {
  sha: string;
  url: string | null;
};

export type FileChange = {
  path: string;
  content: string;
};

export type ProjectRef = {
  externalId: string;
  name: string;
  url: string | null;
};

export type EnvVarTarget = "preview" | "production";

export type EnvVarInput = {
  key: string;
  value: string;
  target: EnvVarTarget;
};

export type DeploymentInfo = {
  externalId: string;
  /** BUILDING | READY | ERROR | CANCELED, as reported by the platform. */
  state: string;
  url: string | null;
  commitSha: string | null;
  createdAt: string;
};

/**
 * Which GitHub App is acting.
 *
 * Creating a repository is the most privileged act in the factory, so it lives
 * in its own App with its own id and its own private key. The everyday App —
 * the one that runs constantly — can commit and read, and can neither create
 * nor delete a repository.
 */
export type GitHubAppRole = "provisioner" | "reconciler";

export type GitHubAppCredential = {
  role: GitHubAppRole;
  appId: string;
  privateKey: string;
};

/**
 * Where the two credentials come from. Keeping this a port, rather than reading
 * the environment inside the provider, is what lets a test prove that an
 * everyday operation never reaches for the privileged key.
 */
export interface GitHubCredentials {
  forProvisioner(): Promise<GitHubAppCredential>;
  forReconciler(): Promise<GitHubAppCredential>;
}
