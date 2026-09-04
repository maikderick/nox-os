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
// The form under the page is a client component; in a test nothing routes.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  // `notFound()` signals by throwing a sentinel Next catches upstream; here the
  // sentinel is ours, and seeing it thrown is seeing the page refuse to render.
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ProjectPage from "@/app/projetos/[id]/page";
import { AuthorizationError } from "@/lib/authz/errors";

import BriefingPage from "@/app/projetos/[id]/briefing/page";

import { legacyBrief, storedBrief } from "../helpers/brief-fixtures";

type ProjectOverrides = {
  status?: string;
  briefVersions?: unknown[];
  currentBriefVersionId?: string | null;
};

function project(overrides: ProjectOverrides = {}) {
  return {
    id: "proj-1",
    name: "Site Zen",
    sector: "Restaurante japonês",
    client: { id: "client-1", name: "Zen Comida Japonesa", businessId: "lead-1" },
    status: "PREVIA_PRONTA",
    currentBriefVersionId: "brief-2",
    // As `getSiteProject` returns them: newest first.
    briefVersions: [
      { id: "brief-2", version: 2, contentJson: JSON.stringify(storedBrief()) },
      { id: "brief-1", version: 1, contentJson: JSON.stringify(storedBrief()) },
    ],
    ...overrides,
  };
}

async function renderPage(overrides: ProjectOverrides = {}): Promise<string> {
  mocks.getSiteProject.mockResolvedValue(project(overrides));
  const element = (await BriefingPage({
    params: Promise.resolve({ id: "proj-1" }),
  })) as React.ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { email: "op@example.test" } });
  mocks.requirePermission.mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    permissions: ["project:read", "project:write", "brief:write"],
  });
});

describe("página de edição do briefing", () => {
  it("exige sessão e a permissão de escrever briefing", async () => {
    await renderPage();

    expect(mocks.requireUser).toHaveBeenCalled();
    // Not `project:read`: this page exists to save a new version, and someone
    // who cannot save should find that out before filling twenty fields.
    expect(mocks.requirePermission).toHaveBeenCalledWith("brief:write");
    // Scoped read: a project from another organization is not found here.
    expect(mocks.getSiteProject.mock.calls[0]?.[1]).toBe("proj-1");
  });

  it("diz o que salvar faz, com o número da versão que será criada", async () => {
    const html = await renderPage();

    expect(html).toContain("Briefing de Site Zen");
    // Two versions stored, so the next one is the third.
    expect(html).toContain("Salvar cria a versão v3");
    expect(html).toContain("Pronto para gerar");
    // O que salvar custa, dito como é: `/sites/[id]` só serve o site a partir
    // de PREVIA_PRONTA, e salvar devolve o projeto para BRIEFING_PRONTO.
    expect(html).toContain("o link público fica indisponível até você clicar em “Gerar site”");
    expect(html).not.toContain("o site publicado continua o anterior");
    expect(html).toContain("Editando a partir da v2");
  });

  it("avisa em destaque quando o endereço público está no ar agora", async () => {
    // PREVIA_PRONTA: o cliente já pode abrir o link. Salvar o derruba.
    expect(await renderPage({ status: "PREVIA_PRONTA" })).toContain(
      "O endereço público deste projeto está no ar agora",
    );
    // BRIEFING_PRONTO: não há link aberto para derrubar, então não há aviso.
    expect(await renderPage({ status: "BRIEFING_PRONTO" })).not.toContain(
      "está no ar agora",
    );
  });

  it("responde 404 para um projeto inexistente ou de outra organização", async () => {
    mocks.getSiteProject.mockRejectedValue(AuthorizationError.missingPermission("project:read"));

    // `notFound()` sinaliza lançando; o que importa é que a página não vaza a
    // diferença entre "não existe" e "não é seu".
    await expect(
      BriefingPage({ params: Promise.resolve({ id: "de-outra-org" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("deixa a recusa da DAL passar para quem não pode escrever briefing", async () => {
    const denied = AuthorizationError.missingPermission("brief:write");
    mocks.requirePermission.mockRejectedValue(denied);

    await expect(BriefingPage({ params: Promise.resolve({ id: "proj-1" }) })).rejects.toBe(denied);
    // E nem chega a ler o projeto.
    expect(mocks.getSiteProject).not.toHaveBeenCalled();
  });

  it("abre no passo Negócio, com o que o projeto já confirmou", async () => {
    const html = await renderPage();

    expect(html).toContain('value="Zen Comida Japonesa"');
    expect(html).toContain('value="Restaurante japonês"');
    expect(html).toContain('value="Fortaleza"');
    // Três passos, começando em Negócio: sem etapa de lead, sem catálogo de
    // nichos — o projeto já tem cliente e o setor se edita como campo.
    expect(html).toContain("repeat(3, minmax(0, 1fr))");
    expect(html).toContain(">Negócio<");
    expect(html).toContain(">Abordagem<");
    expect(html).toContain(">Briefing<");
    expect(html).not.toContain(">Leads<");
    expect(html).not.toContain("Buscar setor");
    // O nome do projeto é interno, e se renomeia na página do projeto.
    expect(html).not.toContain("Nome do projeto");
  });

  it("recusa a edição enquanto o agente constrói, em vez de recusar ao salvar", async () => {
    const html = await renderPage({ status: "GERANDO" });

    expect(html).toContain("Este briefing não pode ser editado agora");
    expect(html).toContain("Construindo repositório");
    // Nem o formulário aparece: preencher vinte campos para ouvir 409 no fim
    // é pior do que não abrir.
    expect(html).not.toContain("Etapas do projeto");
  });

  it("abre um formulário vazio para um projeto que nunca teve briefing", async () => {
    const html = await renderPage({ briefVersions: [], currentBriefVersionId: null });

    expect(html).toContain("Este projeto não tem briefing confirmado");
    expect(html).toContain("Salvar cria a versão v1");
    expect(html).toContain("Etapas do projeto");
  });

  it("avisa que um briefing v1 chega com os campos novos em branco", async () => {
    const html = await renderPage({
      currentBriefVersionId: "brief-legacy",
      briefVersions: [
        { id: "brief-legacy", version: 1, contentJson: JSON.stringify(legacyBrief()) },
      ],
    });

    expect(html).toContain("briefing antigo");
    expect(html).toContain('value="Padaria Aurora"');
    expect(html).toContain("Salvar cria a versão v2");
  });

  it("avisa quando o briefing guarda algo que o formulário não mostra", async () => {
    const brief = storedBrief();
    brief.publicContact.openingHours!.value = [
      { dayOfWeek: "QUARTA", opens: "11:00", closes: "14:00" },
      { dayOfWeek: "QUARTA", opens: "18:00", closes: "23:00" },
    ];
    const html = await renderPage({
      currentBriefVersionId: "brief-9",
      briefVersions: [{ id: "brief-9", version: 9, contentJson: JSON.stringify(brief) }],
    });

    expect(html).toContain("O briefing guarda algo que este formulário não mostra");
    expect(html).toContain("mais de um intervalo neste dia");
  });
});

describe("entrada para o editor, no painel do projeto", () => {
  /**
   * Rendered, not grepped.
   *
   * The first version of this block asserted that the page's *source* named
   * the four states, and it passed while the link was reachable from three of
   * them — the state list was right and the element was written into the wrong
   * branches. Only rendering can tell those two apart.
   */
  async function renderProject(
    overrides: ProjectOverrides & { permissions?: string[] } = {},
  ): Promise<string> {
    const { permissions, ...projectOverrides } = overrides;
    if (permissions) {
      mocks.requirePermission.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        permissions,
      });
    }
    mocks.getSiteProject.mockResolvedValue(project(projectOverrides));
    const element = (await ProjectPage({
      params: Promise.resolve({ id: "proj-1" }),
    })) as React.ReactElement;
    return renderToStaticMarkup(element);
  }

  const EDIT_LINK = 'href="/projetos/proj-1/briefing"';

  const withoutBrief = { briefVersions: [], currentBriefVersionId: null };

  it("aparece nos quatro estados em que uma versão nova é aceita", async () => {
    for (const status of ["RASCUNHO", "BRIEFING_PRONTO", "PREVIA_PRONTA", "FALHOU"]) {
      expect(await renderProject({ status }), status).toContain(EDIT_LINK);
    }
  });

  it("aparece também num RASCUNHO que nunca teve briefing", async () => {
    const html = await renderProject({ status: "RASCUNHO", ...withoutBrief });

    expect(html).toContain(EDIT_LINK);
    // E a única instrução na tela é essa; o assistente de projeto novo não
    // resolve o briefing deste projeto.
    expect(html).toContain("Este projeto ainda não tem briefing.");
    expect(html).not.toContain("projeto novo");
  });

  it("some enquanto uma máquina segura o projeto, e depois que o ciclo avança", async () => {
    for (const status of ["GERANDO", "PUBLICANDO", "EM_REVISAO", "APROVADO", "PUBLICADO"]) {
      expect(await renderProject({ status }), status).not.toContain(EDIT_LINK);
    }
  });

  it("some para quem não pode salvar um briefing", async () => {
    const html = await renderProject({
      status: "BRIEFING_PRONTO",
      permissions: ["project:read", "project:write"],
    });

    expect(html).not.toContain(EDIT_LINK);
    // A ação principal do estado continua lá: some o link, não o painel.
    expect(html).toContain("Gerar o site");
  });

  it("liga o aviso de composição ao briefing que o resolve", async () => {
    // Um briefing sem serviços nem contato: o painel diz o que falta e leva ao
    // formulário onde se completa.
    const bare = storedBrief();
    bare.services = [];
    bare.publicContact = {
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      coordinates: null,
      openingHours: null,
      socialLinks: [],
    };
    const html = await renderProject({
      currentBriefVersionId: "brief-bare",
      briefVersions: [{ id: "brief-bare", version: 1, contentJson: JSON.stringify(bare) }],
    });

    expect(html).toContain("Nenhum serviço confirmado");
    expect(html).toContain("Nenhum canal de contato confirmado");
    expect(html).toContain("Complete no briefing");
  });
});
