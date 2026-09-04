import type { IntegrationMode } from "@/lib/integrations/modes";

import type {
  CheckRun,
  CommitRef,
  DeploymentInfo,
  EnvVarInput,
  FileChange,
  ProjectRef,
  RepoRef,
} from "./types";

/**
 * The git host, split by which App does what.
 *
 * The two halves share one interface but not one credential: the provisioning
 * half creates the repository and applies the ruleset, the everyday half commits
 * and reads. A test asserts the everyday half never reaches for the privileged
 * key.
 */
export interface GitRepositoryProvider {
  readonly id: string;
  readonly mode: IntegrationMode;
  isConfigured(): Promise<boolean>;

  // --- NOX Provisioner ---
  createFromTemplate(input: {
    owner: string;
    name: string;
    templateOwner: string;
    templateRepo: string;
  }): Promise<RepoRef>;

  protectDefaultBranch(input: { repo: RepoRef; requiredChecks: string[] }): Promise<void>;

  // --- NOX Reconciler ---
  getRepository(input: { owner: string; name: string }): Promise<RepoRef | null>;

  commitFiles(input: {
    repo: RepoRef;
    branch: string;
    message: string;
    files: FileChange[];
  }): Promise<CommitRef>;

  /**
   * What checks the host has run against a commit.
   *
   * An empty array means "the host reports none", which is a different fact
   * from "the required one failed" — the observer treats absence as `AUSENTE`
   * only after its deadline, because a check that has not been created yet
   * looks exactly the same as one that never will be.
   */
  listChecks(input: { repo: RepoRef; commitSha: string }): Promise<CheckRun[]>;
}

/**
 * The hosting platform.
 *
 * `promoteToProduction` and `attachDomain` are absent on purpose: publishing is
 * a later phase, and an interface method is an invitation to call it.
 */
export interface HostingProvider {
  readonly id: string;
  readonly mode: IntegrationMode;
  isConfigured(): Promise<boolean>;

  /** Preflight: does the platform's installation actually see this repository? */
  canAccessRepository(input: { repo: RepoRef }): Promise<boolean>;

  /**
   * Finds a project by name.
   *
   * Needed to finish a run that was interrupted between creating the project
   * remotely and recording it here: without it, the only way out would be to
   * delete the project by hand.
   */
  getProject(input: { name: string }): Promise<ProjectRef | null>;

  createProject(input: { name: string; repo: RepoRef }): Promise<ProjectRef>;

  setEnvironmentVariables(input: { project: ProjectRef; vars: EnvVarInput[] }): Promise<void>;

  listDeployments(input: { project: ProjectRef; commitSha?: string }): Promise<DeploymentInfo[]>;
}
