/**
 * What the agent is allowed to touch, decided here and nowhere else.
 *
 * The agent runs with write access to a repository and a model that will
 * happily follow an instruction it found in a file. The blast radius of that is
 * whatever we hand it, so what we hand it is built by one function, checked
 * before any call, and fixed by tests.
 *
 * Four decisions, each of which was a plausible convenience:
 *
 *   * **exactly one repository.** Zero is a run with nothing to do; two is one
 *     client's agent holding another client's code. Both are refused before the
 *     provider is reached, because "the agent only had access, it did not write
 *     anything" is not a sentence anyone wants to have to verify.
 *
 *   * **never the current branch.** `workOnCurrentBranch: false` and
 *     `autoCreatePR: true` together mean the output arrives as a proposal on a
 *     branch of its own. The default branch is protected and reviewed; an agent
 *     that could push to it would make that protection decorative.
 *
 *   * **no MCP server.** An MCP server is another tool surface, granted for the
 *     duration of a run nobody is watching. When one is needed it will be a
 *     decision with its own name, not a field someone filled in.
 *
 *   * **secret references, never secret values.** The scope carries a
 *     `purpose` — the name of a `SecretRef` — and the resolution happens at the
 *     edge that actually calls out. Putting a resolved token in this object
 *     would put it in every log line, error report and test fixture that ever
 *     serialises an isolation.
 */

export class AgentIsolationRefusal extends Error {
  readonly code = "ISOLAMENTO_INVALIDO";

  constructor(message: string) {
    super(message);
    this.name = "AgentIsolationRefusal";
  }
}

/** One repository, named the way GitHub names it. */
export type IsolatedRepository = {
  owner: string;
  name: string;
  /** The branch the agent starts from — never the one it writes to. */
  baseBranch: string;
};

export type AgentIsolation = {
  /** Exactly one. The type says "array" because the provider's API does. */
  readonly repos: readonly [IsolatedRepository];
  readonly workOnCurrentBranch: false;
  readonly autoCreatePR: true;
  /** Hosts the run may reach. Anything else is refused by the sandbox. */
  readonly networkAllowlist: readonly string[];
  /**
   * Names of `SecretRef` rows, never resolved values.
   *
   * Empty in this phase: the agent needs the repository it was given and
   * nothing else. The field exists so that adding one later is an explicit
   * change to this list rather than a value appearing in an object.
   */
  readonly secretPurposes: readonly string[];
};

/**
 * Where the agent is allowed to go.
 *
 * The package registries it needs to install dependencies, and the git host
 * holding the one repository it was given. Not our API, not the hosting
 * provider, not a metadata endpoint.
 */
export const AGENT_NETWORK_ALLOWLIST: readonly string[] = [
  "github.com",
  "api.github.com",
  "registry.npmjs.org",
];

export type BuildIsolationParams = {
  repos: readonly IsolatedRepository[];
};

/**
 * Builds the scope, or refuses.
 *
 * The refusal happens here — before the provider, before the credit
 * reservation, before anything is spent — because a scope that is wrong is
 * wrong regardless of how the run would have gone.
 */
export function buildAgentIsolation(params: BuildIsolationParams): AgentIsolation {
  const repos = params.repos;

  if (repos.length !== 1) {
    throw new AgentIsolationRefusal(
      repos.length === 0
        ? "Uma execução do agente precisa de exatamente um repositório, e nenhum foi informado."
        : `Uma execução do agente recebe exatamente um repositório; foram informados ${repos.length}. Dois repositórios no mesmo escopo colocariam o código de um cliente ao alcance da geração de outro.`,
    );
  }

  const repo = repos[0];
  for (const [field, value] of Object.entries(repo)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AgentIsolationRefusal(
        `O repositório informado não tem "${field}". Um escopo incompleto não é um escopo.`,
      );
    }
  }

  return {
    repos: [{ owner: repo.owner, name: repo.name, baseBranch: repo.baseBranch }],
    workOnCurrentBranch: false,
    autoCreatePR: true,
    networkAllowlist: AGENT_NETWORK_ALLOWLIST,
    secretPurposes: [],
  };
}

/** Whether a scope covers a given repository. Used to refuse cross-tenant reads. */
export function isolationCovers(
  isolation: AgentIsolation,
  repo: { owner: string; name: string },
): boolean {
  const [only] = isolation.repos;
  return (
    only.owner.toLowerCase() === repo.owner.toLowerCase() &&
    only.name.toLowerCase() === repo.name.toLowerCase()
  );
}
