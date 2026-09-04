// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InternalNotes } from "@/components/projetos/wizard-fields";

afterEach(cleanup);

function detailsElement(): HTMLDetailsElement {
  const element = document.querySelector("details");
  expect(element).not.toBeNull();
  return element as HTMLDetailsElement;
}

/**
 * The wizard's wiring, in miniature.
 *
 * `invalid` is derived from the field's own content and the fields inside
 * confirm on every keystroke, exactly as `authoredFact` does — that is the
 * whole reason the group must not remount when it flips. `attempt` counts the
 * refusals, as the wizard's counter does.
 */
function Harness() {
  const [value, setValue] = useState("");
  const [attempt, setAttempt] = useState(0);
  const invalid = value.trim().length === 0;

  return React.createElement(
    "div",
    null,
    React.createElement(
      "button",
      { type: "button", onClick: () => setAttempt((current) => current + 1) },
      "Continuar",
    ),
    React.createElement(
      InternalNotes,
      { invalid, attempt },
      React.createElement("textarea", {
        "aria-label": "Objetivo principal",
        value,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value),
      }),
    ),
  );
}

describe("notas internas, no DOM", () => {
  it("abre quando um campo de dentro é o motivo da recusa", () => {
    render(React.createElement(Harness));

    expect(detailsElement().open).toBe(true);
  });

  it("reabre a cada nova tentativa recusada, mesmo depois de fechada à mão", () => {
    render(React.createElement(Harness));

    const details = detailsElement();
    details.open = false;
    expect(details.open).toBe(false);

    // Segunda tentativa, mesmo erro: `invalid` não mudou, então só o contador
    // de tentativas pode reabrir o grupo. Sem ele, o operador ficaria olhando
    // um erro que aponta para dentro de uma caixa fechada.
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(detailsElement().open).toBe(true);
  });

  it("não rouba o foco da textarea quando a primeira letra resolve o erro", () => {
    render(React.createElement(Harness));

    const textarea = screen.getByLabelText("Objetivo principal") as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // A primeira letra confirma o campo e `invalid` vira false. A versão
    // anterior remontava a subárvore aqui (`key` derivada de `invalid`) e o
    // cursor saía de dentro do campo que o operador estava corrigindo.
    fireEvent.change(textarea, { target: { value: "R" } });

    expect(document.activeElement).toBe(
      screen.getByLabelText("Objetivo principal"),
    );
    expect((screen.getByLabelText("Objetivo principal") as HTMLTextAreaElement).value).toBe("R");
    // O nó é o mesmo nó: nada foi remontado.
    expect(screen.getByLabelText("Objetivo principal")).toBe(textarea);
  });

  it("continua aberta depois que o erro é resolvido, em vez de fechar sozinha", () => {
    // Fechar por conta própria enquanto o operador digita esconderia o texto
    // que ele acabou de escrever.
    render(React.createElement(Harness));

    fireEvent.change(screen.getByLabelText("Objetivo principal"), {
      target: { value: "Receber pedidos pelo WhatsApp." },
    });

    expect(detailsElement().open).toBe(true);
  });

  it("deixa o operador fechar o grupo quando não há erro nenhum", () => {
    render(React.createElement(Harness));

    fireEvent.change(screen.getByLabelText("Objetivo principal"), {
      target: { value: "Receber pedidos pelo WhatsApp." },
    });
    const details = detailsElement();
    details.open = false;

    fireEvent.change(screen.getByLabelText("Objetivo principal"), {
      target: { value: "Receber pedidos e dúvidas pelo WhatsApp." },
    });

    expect(detailsElement().open).toBe(false);
  });
});
