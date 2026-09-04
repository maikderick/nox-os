import { beforeEach, describe, expect, it } from "vitest";

import { buildAgentIsolation } from "@/lib/codegen/isolation";
import type { CodeGenerationProvider } from "@/lib/codegen/provider";

/**
 * One contract, run against every mode of the generation agent.
 *
 * The same assertions run against the in-memory implementation and against the
 * recorded fixtures, so a behaviour only the fake has shows up as a failure
 * rather than as a surprise on the first live call. The three that matter most
 * are the ones about repetition: `start` under the same key, `cancel` twice,
 * and `findRunByKey` on a provider that cannot look.
 */
export type AgentHarness = {
  name: string;
  reset: () => void | Promise<void>;
  provider: () => CodeGenerationProvider;
  /** Every `start` that reached the provider, by key, in order. */
  startCalls: () => string[];
  /** Drives the simulated run to completion without waiting on a clock. */
  finish: (provider: CodeGenerationProvider, ref: { id: string; idempotencyKey: string }) => Promise<void>;
};

const REPO = { owner: "nox-sites", name: "site-padaria-aurora", baseBranch: "main" };

export function runAgentContract(harness: AgentHarness): void {
  describe(`contrato do agente · ${harness.name}`, () => {
    beforeEach(async () => {
      await harness.reset();
    });

    const startInput = (key: string) => ({
      idempotencyKey: key,
      isolation: buildAgentIsolation({ repos: [REPO] }),
      prompt: "Construa o site com os fatos confirmados.",
    });

    it("devolve uma referência utilizável, com a chave que recebeu", async () => {
      const ref = await harness.provider().start(startInput("chave-1"));

      expect(ref.id).toBeTruthy();
      // A chave volta porque é ela, e não o id, que permite reencontrar a
      // execução quando o processo morre antes de gravar o id.
      expect(ref.idempotencyKey).toBe("chave-1");
    });

    it("progride e só relata o que produziu ao concluir", async () => {
      const provider = harness.provider();
      const ref = await provider.start(startInput("chave-2"));

      const running = await provider.poll(ref);
      expect(["PENDENTE", "EXECUTANDO"]).toContain(running.state);
      // Uma execução em curso que já relatasse branch e commit deixaria o poll
      // criar uma SiteRevision para trabalho que o agente ainda vai reescrever.
      expect(running.commitSha).toBeUndefined();
      expect(running.branch).toBeUndefined();

      await harness.finish(provider, ref);
      const done = await provider.poll(ref);

      expect(done.state).toBe("CONCLUIDO");
      expect(done.commitSha).toBeTruthy();
      expect(done.branch).toBeTruthy();
      expect(done.pullRequestUrl).toBeTruthy();
    });

    it("a mesma chave nunca inicia uma segunda execução", async () => {
      const provider = harness.provider();
      const first = await provider.start(startInput("chave-3"));
      const second = await provider.start(startInput("chave-3"));

      expect(second.id).toBe(first.id);
    });

    it("cancelar é idempotente, inclusive sobre execução desconhecida", async () => {
      const provider = harness.provider();
      const ref = await provider.start(startInput("chave-4"));

      await expect(provider.cancel(ref)).resolves.toBeUndefined();
      // A segunda chamada acontece justamente quando algo já deu errado. Um
      // cancel que lançasse faria a limpeza ser a coisa que falha.
      await expect(provider.cancel(ref)).resolves.toBeUndefined();
      await expect(
        provider.cancel({ id: "run-que-nao-existe", idempotencyKey: "chave-x" }),
      ).resolves.toBeUndefined();
    });

    it("recusa um escopo que não seja de exatamente um repositório", async () => {
      const provider = harness.provider();

      expect(() => buildAgentIsolation({ repos: [] })).toThrow(/exatamente um repositório/i);
      expect(() =>
        buildAgentIsolation({ repos: [REPO, { ...REPO, name: "site-de-outro-cliente" }] }),
      ).toThrow(/exatamente um repositório/i);

      // E nada chegou ao provedor: a recusa acontece antes da chamada.
      expect(harness.startCalls()).toEqual([]);
      expect(provider.capabilities).toBeDefined();
    });

    it("fixa o isolamento: branch própria, PR automático, sem segredo resolvido", () => {
      const isolation = buildAgentIsolation({ repos: [REPO] });

      expect(isolation.repos).toHaveLength(1);
      expect(isolation.workOnCurrentBranch).toBe(false);
      expect(isolation.autoCreatePR).toBe(true);
      // O escopo carrega `purpose`, nunca valor resolvido — e nesta fase nem
      // isso: o agente precisa do repositório e de mais nada.
      expect(isolation.secretPurposes).toEqual([]);
      expect(JSON.stringify(isolation)).not.toMatch(/ghp_|ghs_|BEGIN |vercel_/);
    });

    describe("findRunByKey", () => {
      it("devolve a execução criada com aquela chave", async () => {
        const provider = harness.provider();
        const ref = await provider.start(startInput("chave-5"));

        const found = await provider.findRunByKey("chave-5");
        expect(found).toMatchObject({ id: ref.id, idempotencyKey: "chave-5" });
      });

      it("devolve nulo para chave desconhecida", async () => {
        const found = await harness.provider().findRunByKey("chave-que-ninguem-usou");
        expect(found).toBeNull();
      });
    });
  });
}
