/**
 * The vocabulary the factory uses to talk to a git host and a hosting platform.
 *
 * Deliberately small: a method that exists is a method someone eventually calls,
 * so promotion to production and domain attachment are absent until the phase
 * that needs them.
 */

/** Owner and name of a repository, as the factory writes them. */
export type RepoCoordinates = {
  owner: string;
  name: string;
};

export type RepoRef = {
  owner: string;
  name: string;
  /** Null until the remote creation happens; synthetic under the fake. */
  externalId: string | null;
  url: string | null;
  defaultBranch: string;
  /**
   * The template this repository was generated from, as the host reports it.
   *
   * This is the evidence that a repository found by name is one the factory
   * created. Null means the host does not claim any template — which is not
   * proof of the opposite, only absence of proof, and the difference decides
   * whether a run may adopt it or has to stop for a person.
   */
  templateRepository: RepoCoordinates | null;
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
  /**
   * The repository this project builds from.
   *
   * A project found by name is worthless as evidence on its own: names collide,
   * and applying environment variables to a homonym wired to somebody else's
   * repository is a live misconfiguration, not a recoverable mistake.
   */
  linkedRepository: RepoCoordinates | null;
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
 * What the git host says about one check on one commit.
 *
 * `conclusion` is the host's own word, not ours. It is translated into the
 * closed set of `GenerationCheck.conclusion` at the edge that stores it, so a
 * word nobody recognised lands as "still pending" and runs out its deadline,
 * rather than being read as a green light.
 */
export type CheckRun = {
  name: string;
  /** queued | in_progress | success | failure | ..., as the host reports it. */
  status: string;
  externalId: string | null;
  commitSha: string;
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
