import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFakeCodeGenerationProvider, type FakeAgentWorld } from "../fake/fake-agent";
import type {
  AgentRunRef,
  AgentRunStatus,
  AgentStartInput,
  CodeGenerationProvider,
} from "../provider";

import { mapAgentRunStatus, type AgentRunPayload } from "./mappers";

/**
 * Replays recorded agent responses through the real mappers.
 *
 * State is still simulated — a recorded exchange cannot answer a question it
 * was never asked, and a run that finishes on the third poll finishes because
 * the fake underneath says so. What comes from the fixtures is the **shape**:
 * the field names, the nesting, the provider's own vocabulary for its states.
 * Identity fields are substituted from the simulated run, exactly as a recorded
 * interaction would be replayed against a different repository.
 *
 * **No HTTP client is imported here, and a test walks these imports to keep it
 * that way.** A sandbox that could reach the network is a live integration with
 * a reassuring name.
 */

const fixturesDir = resolve(process.cwd(), "fixtures/sandbox/cursor");

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

export function createSandboxCodeGenerationProvider(
  options: { world?: FakeAgentWorld } = {},
): CodeGenerationProvider {
  const fake = createFakeCodeGenerationProvider(options);

  return {
    id: "cursor",
    mode: "SANDBOX",

    // The same promises the fake makes. The sandbox proves the shape of the
    // answers, not a different contract — a sandbox that quietly withdrew a
    // capability would exercise a different code path than the one it is
    // standing in for.
    capabilities: fake.capabilities,

    async isConfigured() {
      return true;
    },

    async start(input: AgentStartInput): Promise<AgentRunRef> {
      const ref = await fake.start(input);

      // Round-trips the recorded payload so the start path reads the same
      // fields a live one would, with the id substituted from the run that
      // actually exists locally.
      const payload = readFixture<AgentRunPayload>("agent-run.json");
      mapAgentRunStatus({ ...payload, id: ref.id });

      return ref;
    },

    async poll(ref: AgentRunRef): Promise<AgentRunStatus> {
      const simulated = await fake.poll(ref);

      const payload = readFixture<AgentRunPayload>(
        simulated.state === "CONCLUIDO" ? "agent-run-finished.json" : "agent-run.json",
      );

      // The recorded payload supplies the shape; the simulated run supplies the
      // values, because those are the ones the rest of the chain has to match
      // against a `SiteRevision` and a `GenerationCheck`. Reading the fixture's
      // own sha here would have every sandbox run claim the same commit.
      const mapped = mapAgentRunStatus({
        ...payload,
        id: ref.id,
        status: PROVIDER_WORDS[simulated.state],
        target: {
          ...payload.target,
          branchName: simulated.branch ?? payload.target?.branchName,
          prUrl: simulated.pullRequestUrl ?? payload.target?.prUrl,
        },
        summary: { commitSha: simulated.commitSha ?? payload.summary?.commitSha },
      });

      return mapped;
    },

    async cancel(ref: AgentRunRef): Promise<void> {
      return fake.cancel(ref);
    },

    async findRunByKey(key: string): Promise<AgentRunRef | null> {
      return fake.findRunByKey(key);
    },
  };
}

/**
 * Our vocabulary back into the provider's, so the mapper is exercised in the
 * direction that matters: a recorded word, read by the code that will read the
 * live one.
 */
const PROVIDER_WORDS: Record<AgentRunStatus["state"], string> = {
  PENDENTE: "QUEUED",
  EXECUTANDO: "RUNNING",
  CONCLUIDO: "FINISHED",
  FALHOU: "ERROR",
  CANCELADO: "CANCELLED",
};
