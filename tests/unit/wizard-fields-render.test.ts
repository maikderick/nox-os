import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmableField, InternalNotes, TextField } from "@/components/projetos/wizard-fields";
import { suggestedFact, typedFact, type DraftFact } from "@/lib/site-factory/brief-draft";

const AT = "2026-09-03T12:00:00.000Z";

/** The exact words a prefilled field has to show until someone acts on it. */
const MARK = "sugerido pelo lead — confirme";

const noop = () => {};

function confirmable(fact: DraftFact): string {
  return renderToStaticMarkup(
    React.createElement(ConfirmableField, {
      id: "contato-telefone",
      label: "Telefone",
      fact,
      onValue: noop,
      onConfirm: noop,
    }),
  );
}

describe("marcador de sugestão do lead", () => {
  it("aparece num canal preenchido pelo lead e ainda não confirmado", () => {
    const html = confirmable(suggestedFact("+5585999990000"));

    expect(html).toContain("+5585999990000");
    expect(html).toContain(MARK);
  });

  it("some quando o operador confirma", () => {
    const html = confirmable({ value: "+5585999990000", source: "LEAD", confirmedAt: AT });

    expect(html).not.toContain(MARK);
    expect(html).toContain("Confirmado — será publicado");
  });

  it("some quando o operador reescreve o valor", () => {
    // Editar devolve a origem ao operador, e o campo deixa de ser candidato.
    expect(confirmable(typedFact("+5585900000000"))).not.toContain(MARK);
  });

  it("marca também o campo sem caixa de confirmação própria, como o nome do negócio", () => {
    // O nome do negócio é um `TextField` puro: sem este marcador não haveria
    // nada na tela dizendo que o valor veio do lead e ainda não foi lido.
    const html = renderToStaticMarkup(
      React.createElement(TextField, {
        id: "nome-negocio",
        label: "Nome do negócio",
        value: "Zen Comida Japonesa",
        onChange: noop,
        source: "LEAD",
        pendingLeadSuggestion: true,
      }),
    );

    expect(html).toContain("Zen Comida Japonesa");
    expect(html).toContain(MARK);
    expect(html).toContain("do lead");
  });

  it("não marca o que o operador escreveu", () => {
    const html = renderToStaticMarkup(
      React.createElement(TextField, {
        id: "nome-negocio",
        label: "Nome do negócio",
        value: "Estúdio Aurora",
        onChange: noop,
        source: "OPERADOR",
      }),
    );

    expect(html).not.toContain(MARK);
    expect(html).not.toContain("do lead");
  });
});

describe("notas internas", () => {
  it("chegam recolhidas e dizem que não vão para o site", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        InternalNotes,
        { invalid: false },
        React.createElement("p", null, "Objetivo principal"),
      ),
    );

    expect(html).toContain("Notas internas (não aparecem no site)");
    // `<details>` sem `open` é um grupo recolhido.
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    // Recolhido não é ausente: o campo continua no documento e continua sendo enviado.
    expect(html).toContain("Objetivo principal");
  });

  it("não chegam com `open` controlado nem no caso inválido", () => {
    // Refinamento, não afrouxamento. Antes este caso afirmava `open` no markup
    // estático, o que só era verdade porque o grupo era controlado por prop —
    // o mesmo mecanismo que remontava a subárvore e tirava o foco da textarea
    // que o operador estava corrigindo. A abertura passou a ser um efeito
    // sobre o nó, que `renderToStaticMarkup` não executa por definição; quem
    // prova os três comportamentos agora é `wizard-internal-notes-dom.test.ts`,
    // no DOM. O que o render estático ainda pode provar é o negativo: nenhum
    // `open` vem da renderização.
    const html = renderToStaticMarkup(
      React.createElement(
        InternalNotes,
        { invalid: true },
        React.createElement("p", null, "Objetivo principal"),
      ),
    );

    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("Objetivo principal");
  });
});
