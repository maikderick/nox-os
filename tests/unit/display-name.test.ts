import { describe, expect, it } from "vitest";

import {
  displayBusinessName,
  isShoutingName,
  publicBusinessName,
} from "@/lib/site-factory/display-name";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

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

  it("trata hífen, & e apóstrofo como separador de palavra", () => {
    // Espaço não é o único elo num nome de negócio. Enquanto só ele separava,
    // a segunda palavra vinha em minúscula: "Lava-rápido", "Café&cia",
    // "D'itália", "S/a".
    expect(displayBusinessName("LAVA-RÁPIDO EXPRESS")).toBe("Lava-Rápido Express");
    expect(displayBusinessName("CASA-DO-LAGO")).toBe("Casa-do-Lago");
    expect(displayBusinessName("CAFÉ&CIA")).toBe("Café&Cia");
    expect(displayBusinessName("PIZZARIA D'ITÁLIA")).toBe("Pizzaria D'Itália");
    expect(displayBusinessName("EMPRESA S/A")).toBe("Empresa S/A");
  });

  it("resolve acento como vogal", () => {
    // "SÃO" precisa continuar sendo sílaba, senão vira uma sigla e o nome sai
    // "SÃO Jorge". Um ajuste em SYLLABLE que quebre isto tem de reprovar aqui.
    expect(displayBusinessName("SÃO JOÃO")).toBe("São João");
    expect(displayBusinessName("RESTAURANTE SÃO JORGE")).toBe("Restaurante São Jorge");
  });

  it("trata Y como consoante, para as siglas concordarem entre si", () => {
    // Com "y" na classe de vogais, "XYZ" virava sílaba ("Xyz") e "SKY" não
    // ("SKY") — duas siglas de três letras com destinos opostos.
    expect(displayBusinessName("XYZ SOLUÇÕES")).toBe("XYZ Soluções");
    expect(displayBusinessName("SKY NET")).toBe("SKY Net");
  });

  it("não se perde com dígito no token", () => {
    expect(displayBusinessName("3M AUTOS")).toBe("3M Autos");
    expect(displayBusinessName("M&M PNEUS")).toBe("M&M Pneus");
    expect(displayBusinessName("AUTO PEÇAS 24H")).toBe("Auto Peças 24H");
  });

  it("mantém a partícula no meio do nome", () => {
    expect(displayBusinessName("CASA DE CARNES")).toBe("Casa de Carnes");
  });

  it("relata quando um nome seria reescrito", () => {
    expect(isShoutingName("ZEN COMIDA JAPONESA")).toBe(true);
    expect(isShoutingName("Forno da Esquina")).toBe(false);
  });
});

describe("nome público do briefing", () => {
  function fact(value: string) {
    return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
  }

  function brief(name: string): SiteBrief {
    return siteBriefSchema.parse({
      schemaVersion: 2,
      businessName: fact(name),
      sector: fact("Restaurante"),
      city: fact("Fortaleza"),
      objective: fact("Apresentar o negócio e facilitar novos contatos."),
      audience: fact("Pessoas da região."),
      positioning: fact("Informações claras e verificadas sobre o negócio."),
      differentiators: [],
      desiredSections: ["Início"],
      visualDirection: fact("Sóbrio."),
      notes: null,
      services: [],
      publicContact: {},
      metaDescription: null,
    });
  }

  it("é o único caminho pelo qual uma superfície pública lê o nome", () => {
    // Uma superfície que aplicasse a regra e outra que não aplicasse deixariam
    // a mesma página com dois nomes — foi o que aconteceu entre o corpo e o
    // <title> de /sites/[id].
    expect(publicBusinessName(brief("ZEN COMIDA JAPONESA"))).toBe("Zen Comida Japonesa");
    expect(publicBusinessName(brief("Forno da Esquina"))).toBe("Forno da Esquina");
  });

  it("não reescreve o fato confirmado", () => {
    const parsed = brief("ZEN COMIDA JAPONESA");
    publicBusinessName(parsed);
    expect(parsed.businessName.value).toBe("ZEN COMIDA JAPONESA");
  });
});
