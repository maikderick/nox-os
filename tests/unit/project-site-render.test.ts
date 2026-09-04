import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectSite } from "@/components/sites/project-site";
import { findSlop } from "@/lib/design/anti-slop";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function brief(sector: string, overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact("Aurora"), sector: fact(sector), city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas da região que procuram este tipo de serviço."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [], desiredSections: ["Início", "Contato"],
    visualDirection: fact("Sóbrio e legível."), notes: null, services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
    ...overrides,
  });
}

function render(sector: string, seed: string, overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ProjectSite, { brief: brief(sector, overrides), seed }),
  );
}

/** Every optional block open at once: differentiators, services, hours, location, contact. */
function richFixture() {
  const stamp = "2026-09-03T12:00:00.000Z";
  return {
    // `about` entrou aqui quando deixou de ser incondicional: sem o fato, a
    // seção "Sobre" não existe, e este fixture existe justamente para abrir
    // todos os blocos ao mesmo tempo.
    about: fact("A Aurora atende no centro de Fortaleza, com hora marcada."),
    differentiators: [fact("Atendimento um de cada vez."), fact("Orçamento por escrito.")],
    desiredSections: ["Início", "Sobre", "Serviços", "Horários", "Localização", "Contato"],
    services: [
      { id: "a", name: fact("Corte"), summary: fact("Corte na tesoura ou na máquina."), body: [fact("Acabamento na navalha.")], relatedIds: [], featured: false },
      { id: "b", name: fact("Barba"), summary: fact("Toalha quente e navalha."), body: [fact("Finalização com óleo.")], relatedIds: [], featured: false },
    ],
    publicContact: {
      phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: stamp },
      whatsapp: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: stamp },
      email: { value: "contato@aurora.com.br", source: "CLIENTE" as const, confirmedAt: stamp },
      address: { value: { street: "Rua das Flores", number: "120", complement: "Sala 3", neighborhood: "Centro", city: "Fortaleza", state: "CE", postalCode: "60000-000", country: "Brasil" }, source: "CLIENTE" as const, confirmedAt: stamp },
      coordinates: null,
      openingHours: { value: [{ dayOfWeek: "SEGUNDA" as const, opens: "09:00", closes: "18:00" }, { dayOfWeek: "SABADO" as const, opens: "09:00", closes: "13:00" }], source: "CLIENTE" as const, confirmedAt: stamp },
      socialLinks: [{ value: { platform: "INSTAGRAM" as const, url: "https://instagram.com/aurora", label: "Instagram" }, source: "CLIENTE" as const, confirmedAt: stamp }],
    },
  };
}

const RICH_FIXTURE_SECTORS = ["Barbearia", "Advocacia", "Pizzaria", "Clínica odontológica", "Pousada"];

/** Every CSS declaration of every inline `style` attribute in the markup. */
function styleDeclarations(html: string): string[] {
  return Array.from(html.matchAll(/style="([^"]*)"/g)).flatMap((match) =>
    match[1].split(";").filter((declaration) => declaration.includes(":")),
  );
}

/** The contact section only: from its `id` to the end of the document. */
function contactBlock(html: string): string {
  const start = html.indexOf('id="contato"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

describe("renderizador do site", () => {
  it("não comete nenhuma das regras anti-slop", () => {
    for (const sector of ["Barbearia", "Advocacia", "Pizzaria", "Clínica odontológica", "Pousada"]) {
      const found = findSlop(render(sector, "semente-fixa"));
      expect(found.map((rule) => rule.id), sector).toEqual([]);
    }
  });

  it("não comete nenhuma regra anti-slop com todos os blocos presentes", () => {
    const full = richFixture();
    for (const sector of RICH_FIXTURE_SECTORS) {
      const html = render(sector, "semente-fixa", full);
      expect(findSlop(html).map((rule) => rule.id), sector).toEqual([]);
      expect(html, sector).toContain("Acabamento na navalha.");
      expect(html, sector).toContain("Finalização com óleo.");
    }
  });

  it("nunca usa o accent para colorir texto", () => {
    // The accent may draw an edge (border) or a fill (background), but never
    // a letterform: colouring words with it risks contrast failures the
    // palette was not built to guarantee. Counting occurrences would only
    // freeze today's total; what matters is the *property* every occurrence
    // lands on, so each declaration is checked by name.
    const full = richFixture();
    for (const sector of RICH_FIXTURE_SECTORS) {
      const html = render(sector, "semente-fixa", full);
      expect(html, sector).not.toContain("color:var(--accent)");
      expect(html, sector).not.toContain("color: var(--accent)");
      for (const declaration of styleDeclarations(html)) {
        if (!declaration.includes("var(--accent)")) continue;
        const property = declaration.slice(0, declaration.indexOf(":")).trim();
        expect(
          property.startsWith("background") || property.startsWith("border"),
          `${sector}: ${declaration}`,
        ).toBe(true);
      }
    }
  });

  it("põe uma régua de accent sob cada título de seção", () => {
    // The accent's structural work: a short rule under every `<h2>`. Every
    // direction emits it, including the two whose accent equals the ink.
    const full = richFixture();
    for (const sector of RICH_FIXTURE_SECTORS) {
      expect(render(sector, "semente-fixa", full), sector).toContain("background:var(--accent)");
    }
  });

  it("dá trabalho estrutural ao raio, nas caixas de contato", () => {
    // React serialises the custom property literally, so the rendered row
    // reads `border-radius:var(--radius)` whatever the direction; the value
    // it resolves to is asserted on `<main>`, where `--radius` is defined.
    const full = richFixture();

    const pet = render("Pet shop", "semente-fixa", full);
    expect(pet).toContain("--radius:20px");
    expect(contactBlock(pet)).toContain("border-radius:var(--radius)");
    expect(contactBlock(pet)).toContain("border:1px solid var(--line)");

    const law = render("Advocacia", "semente-fixa", full);
    expect(law).toContain("--radius:0px");
    expect(contactBlock(law)).toContain("border-radius:var(--radius)");
  });

  it("aplica a paleta da direção resolvida", () => {
    const html = render("Barbearia", "semente-fixa");
    const direction = resolveArtDirection({ sector: "Barbearia", seed: "semente-fixa" });
    expect(html).toContain(direction.palette.surface);
    expect(html).toContain(direction.palette.ink);
  });

  it("dá visuais diferentes a categorias diferentes", () => {
    const barbearia = render("Barbearia", "s");
    const advocacia = render("Advocacia", "s");
    expect(barbearia).not.toBe(advocacia);

    const dark = resolveArtDirection({ sector: "Barbearia", seed: "s" });
    const light = resolveArtDirection({ sector: "Advocacia", seed: "s" });
    expect(dark.palette.surface).not.toBe(light.palette.surface);
  });

  it("dá visuais diferentes a dois clientes da mesma categoria", () => {
    const seeds = Array.from({ length: 12 }, (_, index) => `projeto-${index}`);
    const rendered = new Set(seeds.map((seed) => render("Barbearia", seed)));
    expect(rendered.size).toBeGreaterThan(1);
  });

  it("é estável: a mesma semente rende o mesmo markup", () => {
    expect(render("Barbearia", "fixa")).toBe(render("Barbearia", "fixa"));
  });

  it("publica o nome e o posicionamento confirmados", () => {
    const html = render("Barbearia", "s");
    expect(html).toContain("Aurora");
    expect(html).toContain("Informações claras e verificadas sobre o negócio.");
  });

  it("não inventa seção sem fato: sem contato confirmado, sem bloco de contato", () => {
    const html = render("Barbearia", "s");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
  });

  it("publica só o canal confirmado", () => {
    const html = render("Barbearia", "s", {
      publicContact: {
        phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
        whatsapp: null, email: null, address: null, coordinates: null,
        openingHours: null, socialLinks: [],
      },
    });
    expect(html).toContain("tel:+5585999998888");
    expect(html).not.toContain("wa.me");
  });

  it("não vaza marca da fábrica para o site do cliente", () => {
    expect(render("Barbearia", "s")).not.toMatch(/NOX|nox-os/i);
  });

  it("dá estrutura de serviços diferente a dispositivos diferentes", () => {
    const withService = {
      services: [{ id: "corte", name: fact("Corte"), summary: fact("Corte na tesoura ou na máquina."),
        body: [fact("Acabamento na navalha.")], relatedIds: [], featured: false }],
    };
    const food = render("Pizzaria", "s", withService);      // menu-leader
    const auto = render("Oficina mecânica", "s", withService); // spec-table
    const law = render("Advocacia", "s", withService);       // bound-spine
    expect(food).toContain("dotted");
    expect(auto).toContain("tabular-nums");
    expect(law).toContain("border-left");
    // The negatives: `tabular-nums` is also emitted by the `hours` block, so
    // without these a regression that spined or leadered every device would
    // still pass. `border-left` occurs once in the renderer, in the spine
    // branch, so it discriminates on its own.
    expect(food).not.toContain("border-left");
    expect(auto).not.toContain("dotted");
    expect(law).not.toContain("dotted");
    expect(new Set([food, auto, law]).size).toBe(3);
  });

  it("publica o preço confirmado, como o operador digitou, nas quatro famílias", () => {
    // One sector per device family: Pizzaria is `menu-leader`, Academia an
    // index device, Advocacia the spine, Pet shop the plain fallback. The
    // price is a confirmed fact like any other — `content-integrity`'s `preco`
    // rule reads narrative prose at parse time, and a structured `price` is
    // not prose — so it is published verbatim, with no currency formatting.
    const priced = {
      services: [
        {
          id: "corte",
          name: fact("Corte"),
          summary: fact("Corte na tesoura ou na máquina."),
          body: [fact("Acabamento na navalha.")],
          price: fact("R$ 45"),
          relatedIds: [],
          featured: false,
        },
      ],
    };

    for (const sector of ["Pizzaria", "Academia", "Advocacia", "Pet shop"]) {
      const html = render(sector, "semente-fixa", priced);
      expect(html, sector).toContain("R$ 45");
      expect(findSlop(html).map((rule) => rule.id), sector).toEqual([]);
    }
  });

  it("não inventa preço: sem o fato, nada aparece", () => {
    const html = render("Pizzaria", "semente-fixa", {
      services: [
        {
          id: "corte",
          name: fact("Corte"),
          summary: fact("Corte na tesoura ou na máquina."),
          body: [fact("Acabamento na navalha.")],
          relatedIds: [],
          featured: false,
        },
      ],
    });
    expect(html).not.toContain("R$");
  });

  it("nunca sintetiza negrito sobre Instrument Serif", () => {
    // events (Fotógrafo) is the only category whose display face is
    // instrument-serif, and that family ships a single real weight, 400.
    // Any heavier fontWeight asked of it renders as a browser-synthesized
    // ("fake") bold, so it must never appear in the markup.
    const events = render("Fotógrafo", "s");
    expect(events).not.toContain("font-weight:500");
    expect(events).not.toContain("font-weight:600");

    // Any other display face keeps its nominal weight, so the same markup
    // for a non-instrument-serif category still carries 500 somewhere.
    const law = render("Advocacia", "s");
    expect(law).toContain("font-weight:500");
  });
});

/** One sector per device family: leader, index, spine and the plain fallback. */
const DEVICE_FAMILY_SECTORS = ["Pizzaria", "Academia", "Advocacia", "Pet shop"];

describe("o site nunca publica o que o operador respondeu sobre a encomenda", () => {
  it("não imprime o objetivo nem o público em nenhuma das quatro famílias", () => {
    // O defeito real: um site que dizia ao visitante "criar um site
    // minimalista focado em vendas" e "publico voltado a comida" — as duas
    // respostas que o operador deu sobre o trabalho, publicadas como se
    // fossem a apresentação do negócio.
    const internal = {
      objective: fact("criar um site focado em vendas"),
      audience: fact("publico voltado a comida"),
      about: fact("A Aurora serve culinária japonesa no centro de Fortaleza."),
      desiredSections: ["Início", "Sobre", "Contato"],
    };

    for (const sector of DEVICE_FAMILY_SECTORS) {
      const html = render(sector, "semente-fixa", internal);
      expect(html, sector).not.toContain("criar um site focado em vendas");
      expect(html, sector).not.toContain("publico voltado a comida");
    }
  });

  it("publica a apresentação confirmada sob o título Sobre", () => {
    const presentation = "A Aurora serve culinária japonesa no centro de Fortaleza.";
    for (const sector of DEVICE_FAMILY_SECTORS) {
      const html = render(sector, "semente-fixa", {
        about: fact(presentation),
        desiredSections: ["Início", "Sobre", "Contato"],
      });
      const sobre = html.slice(html.indexOf('id="sobre"'));
      expect(html, sector).toContain('id="sobre"');
      expect(sobre, sector).toContain(presentation);
      expect(findSlop(html).map((rule) => rule.id), sector).toEqual([]);
    }
  });

  it("sem apresentação confirmada, não existe seção Sobre", () => {
    // Nada de placeholder: um fato ausente apaga a seção.
    const html = render("Barbearia", "s", { desiredSections: ["Início", "Sobre", "Contato"] });
    expect(html).not.toContain('id="sobre"');
    expect(html).not.toContain(">Sobre<");
  });
});

describe("caixa do nome do negócio", () => {
  it("desliga o caixa-alta de um nome importado aos gritos, sem tocar no fato", () => {
    const shouted = { businessName: fact("ZEN COMIDA JAPONESA") };

    for (const sector of DEVICE_FAMILY_SECTORS) {
      const html = render(sector, "semente-fixa", shouted);
      expect(html, sector).toContain("Zen Comida Japonesa");
      // O `text-transform:uppercase` de algumas direções continua sendo
      // decisão da direção de arte; o que não pode é o texto chegar gritado.
      expect(html, sector).not.toContain("ZEN COMIDA JAPONESA");
    }
  });

  it("usa o mesmo nome no wordmark, no título, no CTA e no rodapé", () => {
    const html = render("Barbearia", "s", {
      businessName: fact("PADARIA DO JOÃO"),
      publicContact: {
        phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
        whatsapp: null, email: null, address: null, coordinates: null,
        openingHours: null, socialLinks: [],
      },
    });
    // Wordmark, <h1>, "Falar com …" e rodapé — quatro ocorrências.
    expect(html.split("Padaria do João").length - 1).toBe(4);
    expect(html).not.toContain("PADARIA DO JOÃO");
  });

  it("deixa intacto o nome que o dono escreveu com minúsculas", () => {
    expect(render("Barbearia", "s", { businessName: fact("Forno da Esquina") })).toContain(
      "Forno da Esquina",
    );
  });
});
