import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAgentIsolation, AgentIsolationRefusal } from "../../src/lib/codegen/isolation";
import {
  createBlindCodeGenerationProvider,
  createFakeCodeGenerationProvider,
  FakeAgentWorld,
  sharedFakeAgentWorld,
} from "../../src/lib/codegen/fake/fake-agent";
import { AgentReconciliationUnsupportedError } from "../../src/lib/codegen/provider";
import { getCodeGenerationProvider } from "../../src/lib/codegen/registry";
import { createSandboxCodeGenerationProvider } from "../../src/lib/codegen/sandbox/sandbox-agent";
import { runAgentContract } from "../contract/agent-contract";

const REPO = { owner: "nox-sites", name: "site-padaria-aurora", baseBranch: "main" };

/**
 * The same contract in `FALSO` and in `SANDBOX`.
 *
 * The fake decides both the question and the answer, so on its own it can never
 * catch a field nested one level deeper than assumed. The sandbox replays
 * recorded payloads through the real mappers, which is the half that can.
 */
for (const harness of [
  {
    name: "FALSO",
    world: new FakeAgentWorld(),
    create: (world: FakeAgentWorld) => createFakeCodeGenerationProvider({ world }),
  },
  {
    name: "SANDBOX",
    world: new FakeAgentWorld(),
    create: (world: FakeAgentWorld) => createSandboxCodeGenerationProvider({ world }),
  },
]) {
  runAgentContract({
    name: harness.name,
    reset: () => {
      harness.world.reset();
      // The provider world is a different simulation; these suites are about
      // the agent alone, so nothing is published into it.
      harness.world.providerWorld = null;
      harness.world.pollsBeforeFinish = 1;
    },
    provider: () => harness.create(harness.world),
    startCalls: () => [...harness.world.startCalls],
    finish: async (provider, ref) => {
      // Advances by polling rather than by waiting: a fake that finished after
      // a real two seconds would make every test either slow or flaky.
      for (let i = 0; i < 5; i += 1) {
        const status = await provider.poll(ref);
        if (status.state !== "PENDENTE" && status.state !== "EXECUTANDO") return;
      }
    },
  });
}

describe("registro do provedor de geração", () => {
  it("escolhe pelo modo, e DESLIGADO recusa tudo", async () => {
    const disabled = getCodeGenerationProvider("DESLIGADO");

    expect(disabled.mode).toBe("DESLIGADO");
    expect(await disabled.isConfigured()).toBe(false);
    // Recusar, em vez de devolver um no-op: uma integração desligada nunca pode
    // ser confundida com uma que deu certo.
    await expect(
      disabled.start({
        idempotencyKey: "k",
        isolation: buildAgentIsolation({ repos: [REPO] }),
        prompt: "p",
      }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });
    await expect(disabled.cancel({ id: "x", idempotencyKey: "k" })).rejects.toMatchObject({
      code: "INTEGRACAO_DESLIGADA",
    });
  });

  it("devolve o falso e o sandbox nos seus modos", () => {
    expect(getCodeGenerationProvider("FALSO").mode).toBe("FALSO");
    expect(getCodeGenerationProvider("SANDBOX").mode).toBe("SANDBOX");
  });

  it("recusa LIVE, que continua sendo decisão separada", () => {
    expect(() => getCodeGenerationProvider("LIVE")).toThrow(/LIVE/);
  });
});

describe("reconciliação por chave", () => {
  it("um provedor sem a capacidade lança, em vez de devolver nulo", async () => {
    const world = new FakeAgentWorld();
    world.providerWorld = null;
    const blind = createBlindCodeGenerationProvider({ world });

    expect(blind.capabilities).toEqual({ idempotentStart: false, reconcileByKey: false });
    // Nulo mentiria: afirmaria que nada existe, e este provedor não tem como
    // saber. É essa mentira que autorizaria uma segunda chamada paga.
    await expect(blind.findRunByKey("qualquer")).rejects.toBeInstanceOf(
      AgentReconciliationUnsupportedError,
    );
  });

  it("o falso e o sandbox declaram as duas capacidades", () => {
    expect(getCodeGenerationProvider("FALSO").capabilities).toEqual({
      idempotentStart: true,
      reconcileByKey: true,
    });
    expect(getCodeGenerationProvider("SANDBOX").capabilities).toEqual({
      idempotentStart: true,
      reconcileByKey: true,
    });
  });

  it("o provedor desligado também não finge saber consultar", async () => {
    await expect(getCodeGenerationProvider("DESLIGADO").findRunByKey("k")).rejects.toBeInstanceOf(
      AgentReconciliationUnsupportedError,
    );
  });
});

describe("isolamento por repositório", () => {
  it("recusa zero e recusa dois, antes de qualquer chamada", () => {
    expect(() => buildAgentIsolation({ repos: [] })).toThrow(AgentIsolationRefusal);
    expect(() =>
      buildAgentIsolation({ repos: [REPO, { ...REPO, name: "site-de-outro-cliente" }] }),
    ).toThrow(AgentIsolationRefusal);
  });

  it("o escopo de A não contém o repositório de B", () => {
    const isolation = buildAgentIsolation({ repos: [REPO] });
    const outro = { owner: "nox-sites", name: "site-de-outro-cliente" };

    expect(isolation.repos[0]).toMatchObject({ owner: REPO.owner, name: REPO.name });
    expect(isolation.repos.some((r) => r.name === outro.name)).toBe(false);
  });

  it("recusa um repositório com campo vazio", () => {
    expect(() => buildAgentIsolation({ repos: [{ ...REPO, owner: "  " }] })).toThrow(
      AgentIsolationRefusal,
    );
  });

  it("a rede é allowlist, e não inclui o NOX OS nem a hospedagem", () => {
    const { networkAllowlist } = buildAgentIsolation({ repos: [REPO] });

    expect(networkAllowlist).toContain("github.com");
    expect(networkAllowlist.some((host) => host.includes("vercel"))).toBe(false);
    expect(networkAllowlist.some((host) => host.includes("noxos"))).toBe(false);
  });
});

describe("o sandbox não fala com a rede", () => {
  it("nenhum cliente HTTP entra no módulo", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/codegen/sandbox/sandbox-agent.ts"),
      "utf8",
    );

    // Um sandbox que pudesse alcançar a rede é uma integração live com um nome
    // tranquilizador.
    expect(source).not.toMatch(/\bfetch\b|axios|node:https?\b|undici|got\b/);
  });

  it("as fixtures não carregam nada com cara de segredo", () => {
    const dir = resolve(process.cwd(), "fixtures/sandbox/cursor");

    for (const file of readdirSync(dir)) {
      const content = readFileSync(resolve(dir, file), "utf8");
      expect(content).not.toMatch(
        /ghp_|ghs_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|Authorization|Bearer |secret|token/i,
      );
    }
  });
});

describe("o mundo compartilhado do falso", () => {
  it("volta ao estado inicial quando pedido", () => {
    sharedFakeAgentWorld.runs.set("x", {} as never);
    sharedFakeAgentWorld.reset();

    expect(sharedFakeAgentWorld.runs.size).toBe(0);
    expect(sharedFakeAgentWorld.startCalls).toEqual([]);
  });
});
