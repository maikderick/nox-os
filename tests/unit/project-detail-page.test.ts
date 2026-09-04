import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requirePermission: vi.fn(),
  getSiteProject: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/authz/dal", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/site-factory/project-service", () => ({ getSiteProject: mocks.getSiteProject }));
// The buttons on this page are client components; in a test nothing routes.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ProjectPage from "@/app/projetos/[id]/page";
import { resolveArtDirection } from "@/lib/design/art-direction";

import { storedBrief } from "../helpers/brief-fixtures";

/**
 * The project panel, rendered.
 *
 * This file used to read the page's source and assert that strings existed in
 * it. That is how a link written into three of four branches passed a test
 * named for the four states it was supposed to cover: the strings were all
 * there, and the element still never reached the operator. Everything here now
 * goes through the component, in the state the operator would be in.
 */

const LIST = "src/app/projetos/page.tsx";

type Overrides = {
  status?: string;
  briefVersions?: unknown[];
  currentBriefVersionId?: string | null;
  permissions?: string[];
};

function project(overrides: Omit<Overrides, "permissions"> = {}) {
  return {
    id: "proj-1",
    name: "Site Zen",
    sector: "Restaurante japonês",
    client: { id: "client-1", name: "Zen Comida Japonesa", businessId: "lead-1" },
    status: "BRIEFING_PRONTO",
    currentBriefVersionId: "brief-1",
    briefVersions: [{ id: "brief-1", version: 1, contentJson: JSON.stringify(storedBrief()) }],
    ...overrides,
  };
}

const ALL_PERMISSIONS = ["project:read", "project:write", "brief:write", "generation:run"];

async function render({ permissions = ALL_PERMISSIONS, ...overrides }: Overrides = {}): Promise<string> {
  mocks.requirePermission.mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    permissions,
  });
  mocks.getSiteProject.mockResolvedValue(project(overrides));
  const element = (await ProjectPage({
    params: Promise.resolve({ id: "proj-1" }),
  })) as React.ReactElement;
  return renderToStaticMarkup(element);
}

const WITHOUT_BRIEF = { briefVersions: [], currentBriefVersionId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { email: "op@example.test" } });
});

describe("raiz do projeto", () => {
  it("exige sessão e permissão de leitura, escopada à organização", async () => {
    await render();

    expect(mocks.requireUser).toHaveBeenCalled();
    expect(mocks.requirePermission).toHaveBeenCalledWith("project:read");
    expect(mocks.getSiteProject.mock.calls[0]?.[1]).toBe("proj-1");
  });

  it("mostra a direção de arte que este projeto realmente recebe", async () => {
    const sector = storedBrief().sector.value;
    const mine = resolveArtDirection({ sector, seed: "proj-1" });
    const other = resolveArtDirection({ sector, seed: "seed-3" });
    // A âncora vem da categoria, e o setor é o que a escolhe; é a semente que
    // escolhe a variante dentro dela, e a paleta é onde isso aparece. Sem a
    // semente do projeto, a página mostraria uma direção que o cliente não
    // recebe — e mostraria a âncora certa o tempo todo, escondendo o erro.
    expect(mine.palette.accent).not.toBe(other.palette.accent);

    const html = await render();

    expect(html).toContain(mine.anchor);
    expect(html).toContain(mine.palette.accent);
    expect(html).not.toContain(other.palette.accent);
  });

  it("leva às três etapas existentes", async () => {
    const html = await render();

    for (const route of ["geracao", "provisionamento", "preview"]) {
      expect(html, route).toContain(`href="/projetos/proj-1/${route}"`);
    }
  });

  it("a listagem passa a linkar a raiz", () => {
    expect(readFileSync(LIST, "utf8")).toMatch(/href=\{`\/projetos\/\$\{project\.id\}`\}/);
  });

  it("abre com a ação principal do estado atual", async () => {
    const html = await render({ status: "BRIEFING_PRONTO" });

    // O operador chega aqui vindo do assistente e precisa ver o que fazer,
    // não um relatório sobre direção de arte.
    expect(html).toContain("Gerar site");
    expect(html).toContain("Gera o site a partir das informações confirmadas. Leva alguns segundos.");
    // E vem antes do painel de direção de arte.
    expect(html.indexOf("Gerar site")).toBeLessThan(html.indexOf("Direção de arte resolvida"));
  });

  it("só oferece gerar a quem a máquina de estados obedeceria", async () => {
    const html = await render({ status: "BRIEFING_PRONTO", permissions: ["project:read"] });

    expect(html).not.toContain("Gerar site");
    expect(html).toContain("Seu papel não permite gerar o site");
  });

  it("leva ao site gerado e à prévia interna", async () => {
    const html = await render({ status: "PREVIA_PRONTA" });

    expect(html).toContain('href="/sites/proj-1"');
    expect(html).toContain("Ver site");
    expect(html).toContain("Prévia interna");
  });

  it("não retipa o nome do estado", async () => {
    // Os rótulos são da máquina de estados. Uma página que os escreve de novo
    // é uma página que continua mostrando o nome antigo depois da renomeação.
    const pronto = await render({ status: "BRIEFING_PRONTO" });
    expect(pronto).toContain("Pronto para gerar");
    expect(pronto).not.toContain("Briefing pronto");

    const gerado = await render({ status: "PREVIA_PRONTA" });
    expect(gerado).toContain("Site gerado");
    expect(gerado).not.toContain("Prévia pronta");
  });

  it("trata a construção do repositório como etapa opcional", async () => {
    expect(await render()).toContain("Construção do repositório (opcional)");
  });

  it("em RASCUNHO, conclui o briefing do próprio projeto", async () => {
    // "Concluir briefing" é uma transição neste projeto
    // (`RASCUNHO -> BRIEFING_PRONTO`, `brief:write`), não um link para o
    // assistente que cria um segundo projeto.
    const html = await render({ status: "RASCUNHO" });

    expect(html).toContain("Concluir briefing");
    expect(html).not.toContain("/projetos/novo");
  });

  it("não oferece concluir o briefing a quem não pode escrevê-lo", async () => {
    const html = await render({ status: "RASCUNHO", permissions: ["project:read"] });

    expect(html).not.toContain("Concluir briefing");
    expect(html).toContain("Seu papel não permite concluir o briefing");
  });

  it("manda preencher o briefing aqui quando o projeto nunca teve um", async () => {
    const html = await render({ status: "RASCUNHO", ...WITHOUT_BRIEF });

    // Uma frase só. Ela já disse "preencha aqui" e "crie um projeto novo" ao
    // mesmo tempo, duas instruções opostas para o mesmo botão, porque não
    // havia editor de briefing por projeto. Há.
    expect(html).toContain(
      "Este projeto ainda não tem briefing. Preencha-o em “Editar briefing”.",
    );
    expect(html).toContain('href="/projetos/proj-1/briefing"');
    expect(html).not.toContain("projeto novo");
    expect(html).not.toContain("/projetos/novo");
  });
});

describe("saída do assistente", () => {
  it("leva o operador à raiz do projeto, onde está a ação", () => {
    const wizard = readFileSync("src/components/projetos/novo-projeto-wizard.tsx", "utf8");
    expect(wizard).toContain("`/projetos/${projectId}`");
    expect(wizard).not.toContain("`/projetos/${projectId}/geracao`");
  });
});
