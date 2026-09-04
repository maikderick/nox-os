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
// The form under the page is a client component; in a test nothing routes.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
    expect(html).toContain("o site publicado continua o anterior até você gerar de novo");
    expect(html).toContain("Editando a partir da v2");
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
  const PAGE = readFileSync("src/app/projetos/[id]/page.tsx", "utf8");

  it("oferece o link só nos estados em que uma nova versão é aceita", () => {
    // Exactly the states `createSiteBriefVersion` can reach BRIEFING_PRONTO
    // from. Anywhere else the link would end in 409.
    expect(PAGE).toContain("Editar briefing");
    expect(PAGE).toContain("href={briefingHref}");
    expect(PAGE).toContain('state === "RASCUNHO" ||');
    expect(PAGE).toContain('state === "BRIEFING_PRONTO" ||');
    expect(PAGE).toContain('state === "PREVIA_PRONTA" ||');
    expect(PAGE).toContain('state === "FALHOU"');
    // And only to someone who could save it.
    expect(PAGE).toContain("canWriteBrief &&");
  });

  it("liga o aviso de composição ao briefing que o resolve", () => {
    expect(PAGE).toContain("Complete no briefing");
    // The warning that already existed, plus what the brief itself reports as
    // missing — both pointing at the same form.
    expect(PAGE).toContain("composition.unmapped.map");
    expect(PAGE).toContain("briefCapabilities(brief).gaps");
  });
});
