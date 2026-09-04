import { createHash } from "node:crypto";

import { sharedFakeWorld, type FakeWorld } from "@/lib/providers/fake/fake-world";
import { REQUIRED_CHECK } from "@/lib/provisioning/naming";

import { AgentIsolationRefusal, type AgentIsolation } from "../isolation";
import {
  AgentReconciliationUnsupportedError,
  type AgentRunRef,
  type AgentRunStatus,
  type AgentStartInput,
  type CodeGenerationProvider,
} from "../provider";

/**
 * An in-memory generation agent.
 *
 * Deterministic on purpose: the same key produces the same run id, the same
 * branch and the same commit sha on every run, so a test asserts on values
 * rather than on shapes. Nothing here opens a socket, reads the clock or
 * touches the filesystem.
 *
 * It advances on being polled, not on elapsed time. A fake that finished after
 * a real two seconds would make every test that waits for it either slow or
 * flaky, and would make the *interesting* test — a poller that has to defer and
 * come back — impossible to write.
 */

export type FakeAgentRun = {
  id: string;
  idempotencyKey: string;
  isolation: AgentIsolation;
  state: AgentRunStatus["state"];
  /** How many polls remain before the run finishes. */
  pollsRemaining: number;
  /** Set on purpose by a test to make the run end badly. */
  failOnFinish: boolean;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
};

function deterministic(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join(" ")).digest("hex");
  return `${prefix}_${digest.slice(0, 24)}`;
}

function deterministicSha(...parts: string[]): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 40);
}

/** The world the fake agent shares, so a test can inspect and steer it. */
export class FakeAgentWorld {
  readonly runs = new Map<string, FakeAgentRun>();
  /** Key -> run id. This is what makes `findRunByKey` answerable. */
  readonly byKey = new Map<string, string>();
  /** Every `start` that reached the provider, for asserting it was not called. */
  readonly startCalls: string[] = [];
  /** How many polls a fresh run takes before finishing. */
  pollsBeforeFinish = 1;
  /** Makes the next run end in `FALHOU`. */
  nextRunFails = false;
  /**
   * Where a finished run's commit is published, so the git host and the hosting
   * platform know about the work the agent did.
   *
   * Set to `null` by a test that wants to see the chain stall on a commit no
   * host has heard of — which is a real failure mode, not an artefact.
   */
  providerWorld: FakeWorld | null = sharedFakeWorld;

  reset(): void {
    this.runs.clear();
    this.byKey.clear();
    this.startCalls.length = 0;
    this.pollsBeforeFinish = 1;
    this.nextRunFails = false;
    this.providerWorld = sharedFakeWorld;
  }

  runFor(key: string): FakeAgentRun | undefined {
    const id = this.byKey.get(key);
    return id ? this.runs.get(id) : undefined;
  }
}

export const sharedFakeAgentWorld = new FakeAgentWorld();

export function createFakeCodeGenerationProvider(
  options: { world?: FakeAgentWorld } = {},
): CodeGenerationProvider {
  const world = options.world ?? sharedFakeAgentWorld;

  const statusOf = (run: FakeAgentRun): AgentRunStatus => {
    if (run.state !== "CONCLUIDO") return { state: run.state };
    // Only a finished run reports what it produced. See `AgentRunStatus`.
    return {
      state: "CONCLUIDO",
      branch: run.branch,
      commitSha: run.commitSha,
      pullRequestUrl: run.pullRequestUrl,
    };
  };

  return {
    id: "cursor",
    mode: "FALSO",

    capabilities: {
      // The fake is the baseline the contract suite runs against, so it
      // promises both — the paths that depend on them have to be exercised
      // somewhere that cannot charge for a mistake.
      idempotentStart: true,
      reconcileByKey: true,
    },

    async isConfigured() {
      return true;
    },

    async start(input: AgentStartInput): Promise<AgentRunRef> {
      world.startCalls.push(input.idempotencyKey);

      // Checked here as well as at build time: an isolation can be constructed
      // correctly and then edited by the code between building and calling.
      if (input.isolation.repos.length !== 1) {
        throw new AgentIsolationRefusal(
          "Uma execução do agente recebe exatamente um repositório.",
        );
      }

      // Idempotent start, which is what `capabilities.idempotentStart` claims.
      // The same key never starts a second run, however many times it arrives.
      const existing = world.runFor(input.idempotencyKey);
      if (existing) return { id: existing.id, idempotencyKey: existing.idempotencyKey };

      const id = deterministic("run", input.idempotencyKey);
      const repo = input.isolation.repos[0];
      const run: FakeAgentRun = {
        id,
        idempotencyKey: input.idempotencyKey,
        isolation: input.isolation,
        state: "EXECUTANDO",
        pollsRemaining: world.pollsBeforeFinish,
        failOnFinish: world.nextRunFails,
        branch: `nox/${id.slice(4, 16)}`,
        commitSha: deterministicSha(id, repo.owner, repo.name),
        pullRequestUrl: `https://github.example/${repo.owner}/${repo.name}/pull/1`,
      };
      world.runs.set(id, run);
      world.byKey.set(input.idempotencyKey, id);
      return { id, idempotencyKey: input.idempotencyKey };
    },

    async poll(ref: AgentRunRef): Promise<AgentRunStatus> {
      const run = world.runs.get(ref.id);
      // An unknown run is not "not finished yet". Saying `EXECUTANDO` would
      // make the poller wait out its full deadline on something that does not
      // exist.
      if (!run) throw new Error(`Execução desconhecida do agente: ${ref.id}`);

      if (run.state === "EXECUTANDO") {
        if (run.pollsRemaining > 0) {
          run.pollsRemaining -= 1;
        } else {
          run.state = run.failOnFinish ? "FALHOU" : "CONCLUIDO";
          if (run.state === "CONCLUIDO") {
            // The two halves of the simulation meet here: the host now has the
            // commit the agent claims to have produced, and CI has reported on
            // it. Without this the observers would poll forever for a commit
            // nobody outside the agent had ever seen.
            const repo = run.isolation.repos[0];
            world.providerWorld?.recordAgentCommit({
              owner: repo.owner,
              name: repo.name,
              commitSha: run.commitSha,
              checkName: REQUIRED_CHECK,
            });
          }
        }
      }

      return statusOf(run);
    },

    async cancel(ref: AgentRunRef): Promise<void> {
      const run = world.runs.get(ref.id);
      // Idempotent, in both directions: cancelling an unknown run and
      // cancelling a finished one are both no-ops. A cancel that threw would
      // make the cleanup path — which runs precisely when something already
      // went wrong — the thing that fails.
      if (!run) return;
      if (run.state === "EXECUTANDO" || run.state === "PENDENTE") run.state = "CANCELADO";
    },

    async findRunByKey(key: string): Promise<AgentRunRef | null> {
      const run = world.runFor(key);
      return run ? { id: run.id, idempotencyKey: run.idempotencyKey } : null;
    },
  };
}

/**
 * A provider that can neither repeat safely nor look a key up.
 *
 * Not a lesser fake — it is the *other* branch of the decision that matters,
 * and without something that answers "no" to both capabilities, the path that
 * sends an ambiguous run to conciliation is never exercised.
 */
export function createBlindCodeGenerationProvider(
  options: { world?: FakeAgentWorld } = {},
): CodeGenerationProvider {
  const capable = createFakeCodeGenerationProvider(options);

  return {
    ...capable,
    capabilities: { idempotentStart: false, reconcileByKey: false },
    async findRunByKey(): Promise<AgentRunRef | null> {
      // Throws rather than returning null. Null would assert that no run
      // exists, and this provider has no way to know that.
      throw new AgentReconciliationUnsupportedError("cursor");
    },
  };
}
