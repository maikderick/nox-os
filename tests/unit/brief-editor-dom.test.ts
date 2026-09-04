// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { BriefEditor } from "@/components/projetos/brief-editor";
import { briefToDraft } from "@/lib/site-factory/brief-draft";
import { siteBriefSchema, type SiteBriefV2 } from "@/lib/site-factory/brief-schema";

import { storedBrief } from "../helpers/brief-fixtures";

/**
 * The whole point of the editor, end to end.
 *
 * A project already produced a site from this briefing. Someone opens it to
 * add one thing; everything else must arrive as it was and leave as it was.
 * The strongest form of that is the last test here: open, save, and the
 * payload is byte-identical to what was stored — same values, same sources,
 * same confirmation dates, which means the same facts hash.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockClear();
  router.refresh.mockClear();
});

function mount(brief: SiteBriefV2 = storedBrief()) {
  // The form scrolls on every step change; jsdom has no implementation.
  vi.stubGlobal("scrollTo", vi.fn());
  render(
    React.createElement(BriefEditor, {
      projectId: "proj-1",
      initialDraft: briefToDraft(brief),
    }),
  );
}

function advance() {
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function value(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

/** A fetch that records what it was asked to send. */
function stubFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 201 : 400),
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("editor de briefing, no DOM", () => {
  it("chega com cada passo preenchido pelo que já estava confirmado", () => {
    mount();

    // Passo 1 — Negócio.
    expect(value("Nome do negócio")).toBe("Zen Comida Japonesa");
    expect(value("Setor")).toBe("Restaurante japonês");
    expect(value("Cidade (opcional)")).toBe("Fortaleza");
    advance();

    // Passo 2 — o texto que o cliente lê, e as notas internas.
    expect(value("Apresentação para o cliente")).toContain("A Zen serve culinária japonesa");
    expect(value("Frase de destaque")).toContain("Balcão de sushi");
    expect(value("Objetivo principal")).toContain("Receber pedidos pelo WhatsApp");
    expect(value("Diferenciais confirmados")).toBe("Balcão de sushi à vista");
    advance();

    // Passo 3 — serviços, contato e horário.
    expect(value("Nome")).toBe("Rodízio de sushi");
    expect(value("Identificador (URL)")).toBe("rodizio-de-sushi");
    expect(value("Conteúdo da página")).toContain("O rodízio é servido no jantar");
    expect(value("Preço (opcional)")).toBe("R$ 120");
    expect(value("Telefone")).toBe("+558533334444");
    expect(value("WhatsApp")).toBe("+5585999990000");
    expect(value("Logradouro")).toBe("Rua das Flores");
    expect(value("Endereço (https)")).toBe("https://instagram.com/zencomidajaponesa");

    // O horário volta aberto no dia que o cliente confirmou, e fechado nos
    // outros seis.
    expect(document.querySelector<HTMLInputElement>("#horario-QUARTA-aberto")?.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#horario-QUARTA-abre")?.value).toBe("18:00");
    expect(document.querySelector<HTMLInputElement>("#horario-QUARTA-fecha")?.value).toBe("23:00");
    expect(
      document.querySelector<HTMLInputElement>("#horario-DOMINGO-aberto")?.checked,
    ).toBe(false);

    // E tudo o que já era confirmado continua confirmado: nada precisa ser
    // reconfirmado só porque alguém abriu a página. O e-mail é o único que o
    // briefing não tinha, e é o único que chega por confirmar.
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id$="-confirmado"]'),
    );
    expect(boxes.length).toBeGreaterThan(3);
    expect(boxes.filter((box) => !box.checked).map((box) => box.id)).toEqual([
      "contato-email-confirmado",
    ]);
  });

  it("salvar sem editar nada devolve exatamente o briefing que foi carregado", async () => {
    const brief = storedBrief();
    mount(brief);
    advance();
    advance();

    const fetchMock = stubFetch({ ok: true, status: 201, body: { capabilities: null } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar e voltar/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/proj-1/brief");
    expect(init.method).toBe("POST");

    // Idêntico ao que estava gravado: mesmos valores, mesmas origens, mesmas
    // datas de confirmação. É isso que faz reabrir um briefing ser seguro.
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual(brief);
    // E o que foi enviado é aceito pelo schema tal como está.
    expect(() => siteBriefSchema.parse(sent)).not.toThrow();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/projetos/proj-1"));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("edita um campo e envia só aquele campo mudado", async () => {
    const brief = storedBrief();
    mount(brief);
    advance();

    fireEvent.change(screen.getByLabelText("Apresentação para o cliente"), {
      target: { value: "A Zen serve culinária japonesa e agora também entrega no centro." },
    });
    advance();

    const fetchMock = stubFetch({ ok: true, status: 201, body: { capabilities: null } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar e voltar/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.about.value).toBe(
      "A Zen serve culinária japonesa e agora também entrega no centro.",
    );
    // Escrever é confirmar, então este campo passa a ser do operador e ganha
    // data nova — e nenhum outro muda junto.
    expect(sent.about.source).toBe("OPERADOR");
    expect(sent.about.confirmedAt).not.toBe(brief.about!.confirmedAt);
    expect({ ...sent, about: brief.about }).toEqual(brief);
  });

  it("diz o que fazer quando o agente está construindo o projeto", async () => {
    mount();
    advance();
    advance();

    stubFetch({ ok: false, status: 409, body: { error: "transição inválida" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar e voltar/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Este projeto está em construção pelo agente; aguarde ou cancele antes de editar.",
    );
    // Ninguém é levado embora de um formulário que não foi salvo.
    expect(router.push).not.toHaveBeenCalled();
  });

  it("mostra os erros por campo quando o schema recusa o briefing", async () => {
    mount();
    advance();
    advance();

    stubFetch({
      ok: false,
      status: 400,
      body: { error: { formErrors: [], fieldErrors: { about: ["Afirmação não sustentada"] } } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar e voltar/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("about: Afirmação não sustentada");
    expect(router.push).not.toHaveBeenCalled();
  });
});
