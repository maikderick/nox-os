import { beforeEach, describe, expect, it } from "vitest";

import type { GitRepositoryProvider, HostingProvider } from "@/lib/providers/ports";
import type { GitHubAppRole } from "@/lib/providers/types";

/**
 * One contract, run against every mode.
 *
 * This is what stops the fake from drifting away from the real thing: the same
 * assertions run against the in-memory implementation and against recorded
 * fixtures, so a behaviour that only the fake has shows up as a failure rather
 * than as a surprise on the first live call.
 */
export type ProviderHarness = {
  name: string;
  /** Called before each test to bring the world back to a known state. */
  reset: () => void | Promise<void>;
  git: () => GitRepositoryProvider;
  hosting: () => HostingProvider;
  /** Which App each call reached for, in order. */
  credentialCalls: () => GitHubAppRole[];
  /** Makes the hosting installation blind to a repository, for the preflight. */
  hideFromHosting: (owner: string, name: string) => void;
};

const OWNER = "nox-sites";
const NAME = "site-padaria-aurora";
const TEMPLATE = { templateOwner: "maikderick", templateRepo: "nox-site-template" };

export function runProviderContract(harness: ProviderHarness): void {
  describe(`contrato de provedores · ${harness.name}`, () => {
    beforeEach(async () => {
      await harness.reset();
    });

    async function createRepo() {
      return harness.git().createFromTemplate({ owner: OWNER, name: NAME, ...TEMPLATE });
    }

    describe("repositório", () => {
      it("cria a partir do template e devolve uma referência utilizável", async () => {
        const repo = await createRepo();

        expect(repo).toMatchObject({ owner: OWNER, name: NAME, defaultBranch: "main" });
        expect(repo.externalId).toBeTruthy();
        expect(repo.url).toContain(NAME);
      });

      it("recusa criar duas vezes o mesmo nome", async () => {
        await createRepo();
        await expect(createRepo()).rejects.toMatchObject({ code: "RECURSO_JA_EXISTE" });
      });

      it("encontra o que existe e devolve nulo para o que não existe", async () => {
        expect(await harness.git().getRepository({ owner: OWNER, name: NAME })).toBeNull();
        await createRepo();
        expect(await harness.git().getRepository({ owner: OWNER, name: NAME })).toMatchObject({
          name: NAME,
        });
      });

      it("protege o branch padrão exigindo apenas o check verify", async () => {
        const repo = await createRepo();
        await expect(
          harness.git().protectDefaultBranch({ repo, requiredChecks: ["verify"] }),
        ).resolves.toBeUndefined();
      });
    });

    describe("conteúdo", () => {
      it("commita arquivos e devolve o sha", async () => {
        const repo = await createRepo();
        const commit = await harness.git().commitFiles({
          repo,
          branch: "main",
          message: "conteúdo inicial",
          files: [{ path: "content/site.json", content: '{"a":1}' }],
        });

        expect(commit.sha).toMatch(/^[0-9a-f]{7,}$/);
      });

      it("não cria um segundo commit para conteúdo idêntico", async () => {
        const repo = await createRepo();
        const files = [{ path: "content/site.json", content: '{"a":1}' }];

        const first = await harness
          .git()
          .commitFiles({ repo, branch: "main", message: "conteúdo", files });
        const second = await harness
          .git()
          .commitFiles({ repo, branch: "main", message: "conteúdo", files });

        expect(second.sha).toBe(first.sha);
      });

      it("cria um novo commit quando o conteúdo muda", async () => {
        const repo = await createRepo();
        const first = await harness.git().commitFiles({
          repo,
          branch: "main",
          message: "conteúdo",
          files: [{ path: "content/site.json", content: '{"a":1}' }],
        });
        const second = await harness.git().commitFiles({
          repo,
          branch: "main",
          message: "conteúdo",
          files: [{ path: "content/site.json", content: '{"a":2}' }],
        });

        expect(second.sha).not.toBe(first.sha);
      });

      it("recusa commitar em repositório inexistente", async () => {
        await expect(
          harness.git().commitFiles({
            repo: {
              owner: OWNER,
              name: "nao-existe",
              externalId: null,
              url: null,
              defaultBranch: "main",
            },
            branch: "main",
            message: "x",
            files: [{ path: "a.txt", content: "a" }],
          }),
        ).rejects.toMatchObject({ code: "RECURSO_INEXISTENTE" });
      });
    });

    describe("separação de credenciais", () => {
      it("usa o Provisioner apenas para criar e proteger", async () => {
        const repo = await createRepo();
        await harness.git().protectDefaultBranch({ repo, requiredChecks: ["verify"] });

        expect(harness.credentialCalls()).toEqual(["provisioner", "provisioner"]);
      });

      it("nunca resolve a credencial do Provisioner numa operação cotidiana", async () => {
        const repo = await createRepo();
        const before = harness.credentialCalls().length;
        await harness.git().getRepository({ owner: OWNER, name: NAME });
        await harness.git().commitFiles({
          repo,
          branch: "main",
          message: "conteúdo",
          files: [{ path: "content/site.json", content: '{"a":1}' }],
        });

        const during = harness.credentialCalls().slice(before);
        expect(during).toEqual(["reconciler", "reconciler"]);
        expect(during).not.toContain("provisioner");
      });
    });

    describe("hospedagem", () => {
      it("enxerga um repositório que existe", async () => {
        const repo = await createRepo();
        expect(await harness.hosting().canAccessRepository({ repo })).toBe(true);
      });

      it("relata quando a instalação não enxerga o repositório", async () => {
        const repo = await createRepo();
        harness.hideFromHosting(OWNER, NAME);
        expect(await harness.hosting().canAccessRepository({ repo })).toBe(false);
      });

      it("cria o projeto ligado ao repositório", async () => {
        const repo = await createRepo();
        const project = await harness.hosting().createProject({ name: NAME, repo });

        expect(project).toMatchObject({ name: NAME });
        expect(project.externalId).toBeTruthy();
      });

      it("recusa criar dois projetos com o mesmo nome", async () => {
        const repo = await createRepo();
        await harness.hosting().createProject({ name: NAME, repo });
        await expect(
          harness.hosting().createProject({ name: NAME, repo }),
        ).rejects.toMatchObject({ code: "RECURSO_JA_EXISTE" });
      });

      it("guarda variáveis de ambiente sem devolvê-las", async () => {
        const repo = await createRepo();
        const project = await harness.hosting().createProject({ name: NAME, repo });

        await expect(
          harness.hosting().setEnvironmentVariables({
            project,
            vars: [{ key: "NOX_SITE_ID", value: "projeto-1", target: "preview" }],
          }),
        ).resolves.toBeUndefined();
      });

      it("lista o deployment do commit que existe no repositório", async () => {
        const repo = await createRepo();
        const commit = await harness.git().commitFiles({
          repo,
          branch: "main",
          message: "conteúdo",
          files: [{ path: "content/site.json", content: '{"a":1}' }],
        });
        const project = await harness.hosting().createProject({ name: NAME, repo });

        const deployments = await harness
          .hosting()
          .listDeployments({ project, commitSha: commit.sha });

        expect(deployments).toHaveLength(1);
        expect(deployments[0]).toMatchObject({ commitSha: commit.sha, state: "READY" });
        expect(deployments[0].url).toBeTruthy();
      });

      it("não inventa deployment para um commit que não existe", async () => {
        const repo = await createRepo();
        const project = await harness.hosting().createProject({ name: NAME, repo });

        expect(
          await harness.hosting().listDeployments({ project, commitSha: "0".repeat(40) }),
        ).toEqual([]);
      });
    });
  });
}
