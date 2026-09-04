import type { CheckRun, CommitRef, DeploymentInfo, ProjectRef, RepoRef } from "../types";

/**
 * Reads the shapes the providers actually return.
 *
 * This is the half a fake cannot prove. The fake decides both the question and
 * the answer, so it can never catch a field that is nested one level deeper than
 * assumed, or a state that arrives as `readyState` instead of `state`. These
 * mappers run against recorded payloads today and are the same code a live
 * client will use.
 */

export type GitHubRepositoryPayload = {
  id: number;
  name: string;
  owner: { login: string };
  html_url: string;
  default_branch: string;
  /** GitHub reports this on a repository generated from a template. */
  template_repository?: { name: string; owner: { login: string } } | null;
};

export function mapGitHubRepository(payload: GitHubRepositoryPayload): RepoRef {
  return {
    owner: payload.owner.login,
    name: payload.name,
    // GitHub reports the id as a number; everything downstream stores text.
    externalId: String(payload.id),
    url: payload.html_url,
    defaultBranch: payload.default_branch,
    // Absent on a repository nobody generated, which is exactly the case a
    // resume has to be able to tell apart.
    templateRepository: payload.template_repository
      ? {
          owner: payload.template_repository.owner.login,
          name: payload.template_repository.name,
        }
      : null,
  };
}

export type GitHubCommitPayload = {
  sha: string;
  html_url: string;
};

export function mapGitHubCommit(payload: GitHubCommitPayload): CommitRef {
  return { sha: payload.sha, url: payload.html_url };
}

export type VercelProjectPayload = {
  id: string;
  name: string;
  /** Vercel calls the connected repository `link`. */
  link?: { org?: string; repo?: string } | null;
  targets?: { production?: { alias?: string[] } };
};

export function mapVercelProject(payload: VercelProjectPayload): ProjectRef {
  const alias = payload.targets?.production?.alias?.[0];
  return {
    externalId: payload.id,
    name: payload.name,
    // Vercel returns bare hostnames, without a scheme.
    url: alias ? `https://${alias}` : null,
    linkedRepository:
      payload.link?.org && payload.link?.repo
        ? { owner: payload.link.org, name: payload.link.repo }
        : null,
  };
}

export type VercelDeploymentPayload = {
  uid: string;
  url: string;
  readyState: string;
  createdAt: number;
  meta?: { githubCommitSha?: string };
};

export function mapVercelDeployment(payload: VercelDeploymentPayload): DeploymentInfo {
  return {
    externalId: payload.uid,
    // `readyState`, not `state`: the field a fake would never have taught us.
    state: payload.readyState,
    url: `https://${payload.url}`,
    commitSha: payload.meta?.githubCommitSha ?? null,
    // Milliseconds since the epoch, not an ISO string.
    createdAt: new Date(payload.createdAt).toISOString(),
  };
}

export type GitHubCheckRunsPayload = {
  total_count: number;
  check_runs: Array<{
    id: number;
    name: string;
    head_sha: string;
    /** queued | in_progress | completed */
    status: string;
    /** success | failure | cancelled | timed_out | ... — null while running. */
    conclusion: string | null;
    html_url?: string;
  }>;
};

/**
 * GitHub reports a check in two fields, and only together do they mean
 * anything: `status` says whether it has finished, `conclusion` says how — and
 * `conclusion` is null until it has. Flattening them here, once, is what keeps
 * every caller from having to remember that a null conclusion is "still
 * running" rather than "no result".
 */
export function mapGitHubCheckRuns(payload: GitHubCheckRunsPayload): CheckRun[] {
  return payload.check_runs.map((run) => ({
    name: run.name,
    status: run.status === "completed" ? (run.conclusion ?? "completed") : run.status,
    externalId: String(run.id),
    commitSha: run.head_sha,
  }));
}
