import { describe, expect, it } from "vitest";

import { displayBusinessName, isShoutingName } from "@/lib/site-factory/display-name";

describe("caixa de exibição do nome do negócio", () => {
  it("desliga o caixa-alta de um nome importado aos gritos", () => {
    expect(displayBusinessName("ZEN COMIDA JAPONESA")).toBe("Zen Comida Japonesa");
  });

  it("preserva a sigla curta e sem vogal", () => {
    // "GM" é uma sigla, "AUTOS" é uma palavra. O comprimento sozinho não
    // separa os dois de "ZEN", que também tem três letras — o que separa é a
    // vogal: uma sigla é curta porque não se pronuncia.
    expect(displayBusinessName("GM AUTOS")).toBe("GM Autos");
    expect(displayBusinessName("CTA TRANSPORTES")).toBe("CTA Transportes");
  });

  it("mantém as conectivas em minúscula", () => {
    expect(displayBusinessName("PADARIA DO JOÃO")).toBe("Padaria do João");
    expect(displayBusinessName("CASA DAS MASSAS E DOCES")).toBe("Casa das Massas e Doces");
  });

  it("não toca num nome que o próprio dono escreveu com minúsculas", () => {
    expect(displayBusinessName("Forno da Esquina")).toBe("Forno da Esquina");
    expect(displayBusinessName("iFood do Bairro")).toBe("iFood do Bairro");
  });

  it("não mexe em nome curto demais para a caixa significar alguma coisa", () => {
    // Menos de quatro letras em caixa alta é sigla com muito mais frequência
    // do que grito: "JJ", "AB1".
    expect(displayBusinessName("JJ")).toBe("JJ");
    expect(displayBusinessName("AB1")).toBe("AB1");
  });

  it("preserva o espaçamento original", () => {
    expect(displayBusinessName("ZEN   COMIDA")).toBe("Zen   Comida");
  });

  it("capitaliza a primeira palavra mesmo sendo conectiva", () => {
    expect(displayBusinessName("DO BRASIL PNEUS")).toBe("Do Brasil Pneus");
  });

  it("relata quando um nome seria reescrito", () => {
    expect(isShoutingName("ZEN COMIDA JAPONESA")).toBe(true);
    expect(isShoutingName("Forno da Esquina")).toBe(false);
  });
});
