// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { NewProjectWizard } from "@/components/projetos/novo-projeto-wizard";

/** The exact words a value nobody has confirmed has to carry. */
const MARK = "sugerido pelo lead — confirme";

const LEAD = {
  id: "lead-1",
  name: "ZEN COMIDA JAPONESA",
  category: "Restaurante",
  city: "Fortaleza",
  state: "CE",
  neighborhood: "Centro",
  address: "Rua das Flores, 120",
  postalCode: "60000-000",
  phoneE164: "+5585999990000",
  website: null,
  socialLinks: ["https://instagram.com/zencomidajaponesa"],
  opportunityScore: 82,
};

const studio = { brandName: "NOX", sellerName: "Maik", city: "Fortaleza" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the wizard with one lead already loaded, on the sector step. */
async function mountWizard() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [LEAD] }) }) as unknown as Response),
  );
  // The component scrolls on every step change; jsdom has no implementation.
  vi.stubGlobal("scrollTo", vi.fn());

  render(React.createElement(NewProjectWizard, { studio }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Restaurante/ })).toBeTruthy());
}

function advance() {
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("assistente de novo projeto, no DOM", () => {
  it("oferece o negócio do lead como candidato marcado, não como fato confirmado", async () => {
    await mountWizard();

    // Etapa 0: o setor é o único campo que segura a etapa.
    fireEvent.click(screen.getByRole("button", { name: /Restaurante/ }));
    advance();

    // Etapa 1: escolher o lead é o que dispara todo o preenchimento.
    fireEvent.click(await screen.findByRole("button", { name: "Usar este negócio" }));
    advance();

    // Etapa 2: o nome chega recomposto, vindo do lead, e ainda por confirmar.
    const name = screen.getByLabelText("Nome do negócio") as HTMLInputElement;
    expect(name.value).toBe("Zen Comida Japonesa");
    expect(screen.getAllByText(MARK).length).toBeGreaterThan(0);

    // E a etapa não passa enquanto ninguém confirmar: é isto que impede um
    // valor lido por nenhuma pessoa de chegar ao site.
    advance();
    expect(screen.getByLabelText("Nome do negócio")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Nome do negócio");
  });

  it("marca telefone, WhatsApp e endereço vindos do lead, e recolhe as notas internas", async () => {
    await mountWizard();

    fireEvent.click(screen.getByRole("button", { name: /Restaurante/ }));
    advance();
    fireEvent.click(await screen.findByRole("button", { name: "Usar este negócio" }));
    advance();

    // Etapa 2: confirmar o nome pelo botão do próprio campo — há mais de um
    // "Usar" na etapa, então o botão é buscado dentro da sugestão deste campo.
    const nameSuggestion = screen
      .getByText("Zen Comida Japonesa", { selector: "span" })
      .closest("p") as HTMLElement;
    fireEvent.click(within(nameSuggestion).getByRole("button", { name: "Usar" }));
    type("Nome do projeto", "Site Zen");
    advance();

    // Etapa 3: as notas internas chegam dentro de um <details> recolhido, com
    // os campos presentes — recolhido não é ausente.
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain("Notas internas (não aparecem no site)");
    expect(details!.querySelector("#objetivo")).not.toBeNull();
    expect(details!.querySelector("#publico")).not.toBeNull();

    type("Apresentação para o cliente", "A Zen serve culinária japonesa no centro de Fortaleza.");
    type("Frase de destaque", "Balcão de sushi e pratos quentes preparados na hora.");
    type("Direção visual", "Sóbrio, escuro e legível.");
    type("Objetivo principal", "Receber pedidos pelo WhatsApp a partir do site.");
    type("Público", "Moradores e escritórios da região central.");
    advance();

    // Etapa 4: os canais do lead estão preenchidos e todos marcados.
    expect((screen.getByLabelText("Telefone") as HTMLInputElement).value).toBe("+5585999990000");
    expect((screen.getByLabelText("WhatsApp") as HTMLInputElement).value).toBe("+5585999990000");
    expect((screen.getByLabelText("Logradouro") as HTMLInputElement).value).toBe(
      "Rua das Flores, 120",
    );
    expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe("Fortaleza");
    // Telefone, WhatsApp, endereço e a rede social: quatro marcas.
    expect(screen.getAllByText(MARK)).toHaveLength(4);

    // Nenhum deles está confirmado, então nenhum seria publicado.
    for (const box of Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][id$="-confirmado"]'),
    )) {
      expect(box.checked, box.id).toBe(false);
    }
  });
});
