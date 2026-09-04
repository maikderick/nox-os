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

/** The content of every `<style>` element in the markup. */
function styleSheets(html: string): string[] {
  return Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((match) => match[1]);
}

/**
 * The at-rule blocks of a stylesheet, by name, with braces actually balanced.
 *
 * Splitting on the at-rule string and calling the tail "inside the block" is
 * what the first version of this test did, and it proved nothing: a rule
 * written *after* the block closed counted as guarded. Counting braces is the
 * difference between asserting containment and asserting order.
 */
function atRuleBlocks(css: string, atRule: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(atRule, from);
    if (start === -1) return blocks;
    const open = css.indexOf("{", start);
    if (open === -1) return blocks;
    let depth = 0;
    let index = open;
    for (; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(css.slice(open + 1, index));
    from = index + 1;
  }
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

  it("nunca usa nenhum dos dois acentos para colorir texto, nem no <style> do hero", () => {
    // O mesmo princípio do teste acima, estendido ao token do hero e às regras
    // da folha de estilo — que o teste anterior não olhava. `--hero-accent`
    // desenha a borda do CTA e o traço dos motivos; nunca uma letra.
    const full = richFixture();
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      for (const token of ["var(--accent)", "var(--hero-accent)"]) {
        expect(html, `${id}: ${token}`).not.toContain(`color:${token}`);
        expect(html, `${id}: ${token}`).not.toContain(`color: ${token}`);
      }
      // Nas folhas de estilo emitidas, toda declaração que cita o acento do
      // hero desenha: uma borda no CSS do hero, um `fill`/`stroke` no do
      // motivo. `color` é a propriedade da tipografia nos dois mundos, e é
      // dela que o acento fica fora — um numeral decorativo dentro de um SVG
      // `aria-hidden` é uma forma, não uma palavra publicada.
      for (const sheet of styleSheets(html)) {
        for (const declaration of sheet.split(/[;{}]/)) {
          if (!declaration.includes("var(--hero-accent)")) continue;
          const property = declaration.slice(0, declaration.indexOf(":")).trim();
          expect(
            property.startsWith("border") || property === "fill" || property === "stroke",
            `${id}: ${declaration}`,
          ).toBe(true);
        }
      }
      // E o CTA do hero é onde ela está.
      expect(html, id).toContain("border:1px solid var(--hero-accent)");
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

/** One sector per category, with the motif its direction has to draw. */
const CATEGORY_CASES: [string, string, string][] = [
  ["food", "Pizzaria", "azulejo"],
  ["beauty", "Barbearia", "navalha"],
  ["fitness", "Academia", "placar"],
  ["pet", "Pet shop", "patas"],
  ["auto", "Oficina mecânica", "manual"],
  ["education", "Escola de idiomas", "grade-horaria"],
  ["retail", "Loja de roupas", "vitrine"],
  ["events", "Fotógrafo", "passe-partout"],
  ["realestate", "Imobiliária", "planta"],
  ["professional", "Advocacia", "encadernacao"],
  ["health", "Consultório odontológico", "luz-difusa"],
  ["services", "Chaveiro", "ficha"],
  ["tourism", "Pousada", "entardecer"],
  ["catalog", "Catálogo", "indice"],
];

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("hero imersivo", () => {
  // A reversão de 2026-09-04 (spec §13, errata 6): o dono pediu o impacto de
  // um hero de tela cheia, e o preço foram três regras anti-slop e o
  // orçamento de movimento abertos — só no hero. Estes testes são o cerco: o
  // que foi liberado aparece uma vez, dentro do hero, e não escapa para o
  // corpo da página.
  const full = richFixture();

  it("desenha o motivo da categoria, e um diferente para cada uma", () => {
    const drawn = new Set<string>();
    for (const [id, sector, motif] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      expect(html, `${id}: sem motivo`).toContain('data-category-motif=""');
      expect(html, `${id}: motivo errado`).toContain(`data-motif="${motif}"`);
      drawn.add(motif);
    }
    expect(drawn.size).toBe(14);
  });

  it("acende exatamente um spotlight, e nenhuma regra anti-slop cai", () => {
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      expect(occurrences(html, "data-hero-spotlight"), id).toBe(1);
      expect(findSlop(html).map((rule) => rule.id), id).toEqual([]);
    }
  });

  it("dá ao título o tamanho fluido do hero, não o passo --text-display", () => {
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      expect(html, id).toContain('<h1 class="site-hero-title"');
      expect(html, id).toContain("font-size:clamp(3rem,8vw,7rem)");
    }
  });

  it("põe o hero em preto puro sobre um corpo claro nas cinco categorias escolhidas", () => {
    // `beauty` e `tourism` já abrem no escuro porque a página inteira é
    // escura: o marcador diz o chão resolvido, não o campo do catálogo, e é
    // por isso que a inversão só é asseverada nas cinco.
    const inverted = ["food", "fitness", "auto", "retail", "events"];
    const darkHero = [...inverted, "beauty", "tourism"];

    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      expect(html, id).toContain(
        `data-hero-ground="${darkHero.includes(id) ? "dark" : "light"}"`,
      );
      if (!inverted.includes(id)) continue;
      expect(html, id).toContain("--hero-surface:#000000");
      // O corpo não segue o hero: dois chãos no total, nunca um terceiro.
      expect(html, id).toContain('data-ground="light"');
      expect(html, id).not.toContain("--surface:#000000;");
    }
  });

  it("guarda todo movimento atrás de prefers-reduced-motion, sem hover e sem transition", () => {
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      const sheets = styleSheets(html);
      expect(sheets.length, `${id}: folhas de estilo`).toBeGreaterThan(0);

      for (const sheet of sheets) {
        // O que fica fora dos blocos de reduced-motion, medido de verdade:
        // recortando cada bloco balanceado, o que sobra não pode conter nem
        // uma `@keyframes` nem uma `animation:`.
        let outside = sheet;
        for (const block of atRuleBlocks(sheet, "@media (prefers-reduced-motion")) {
          outside = outside.replace(block, "");
        }
        expect(outside, `${id}: @keyframes fora do bloco`).not.toContain("@keyframes");
        expect(outside, `${id}: animation fora do bloco`).not.toContain("animation:");
        expect(sheet, `${id}: transition`).not.toContain("transition");
        expect(sheet, `${id}: hover`).not.toContain("hover");
      }

      // E toda `animation:` do documento está numa folha de estilo — nenhuma
      // veio num `style` inline, onde nenhuma media query poderia guardá-la.
      const inSheets = sheets.join("").split("animation:").length - 1;
      expect(occurrences(html, "animation:"), `${id}: animação inline`).toBe(inSheets);
      expect(html, id).not.toContain("transition");
      expect(html, id).not.toContain("hover");
    }
  });

  it("põe o cabeçalho no chão do hero, e o corpo no seu", () => {
    // Uma faixa clara colada sobre um hero preto é um terceiro chão, e lê como
    // banner, não como abertura. O cabeçalho segue o hero; o corpo, não.
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header"));
      expect(header, id).toContain("background:var(--hero-surface)");
      expect(header, id).toContain("color:var(--hero-ink)");
      expect(header, id).toContain("color:var(--hero-ink-muted)");
      expect(header, id).not.toContain("background:var(--surface)");

      const inverted = ["food", "fitness", "auto", "retail", "events"].includes(id);
      // Sem costura a esconder, a régua inferior sai: sobre preto ela seria um
      // risco claro atravessando o topo da página.
      expect(header.includes("border-bottom:1px solid var(--line)"), id).toBe(!inverted);
      // O corpo continua no chão da direção.
      const body = html.slice(html.indexOf('id="sobre"'));
      expect(body, id).toContain("background:var(--surface-alt)");
    }
  });

  it("ancora a exceção do linter num hero de verdade", () => {
    // `findSlop` só concede o gradiente e o blur a um fragmento que esteja
    // dentro de `<section data-hero>`; sem o marcador, o hero real reprovaria.
    for (const [id, sector] of CATEGORY_CASES) {
      const html = render(sector, `semente-${id}`, full);
      expect(occurrences(html, 'data-hero=""'), id).toBe(1);
      expect(findSlop(html.replace('data-hero=""', "")).map((rule) => rule.id), id).toContain(
        "gradient-ground",
      );
    }
  });

  it("não publica no hero o que o operador respondeu sobre a encomenda", () => {
    const html = render("Pizzaria", "s", {
      ...full,
      objective: fact("criar um site focado em vendas"),
      audience: fact("publico voltado a comida"),
    });
    const hero = html.slice(html.indexOf('id="inicio"'), html.indexOf('id="sobre"'));
    expect(hero).toContain("Informações claras e verificadas sobre o negócio.");
    expect(hero).not.toContain("criar um site focado em vendas");
    expect(hero).not.toContain("publico voltado a comida");
  });
});

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
      expect(html, sector).toContain('id="sobre"');
      // Fatiado até a próxima seção: correr até o fim do documento faria a
      // asserção passar com o texto impresso em qualquer bloco posterior.
      const start = html.indexOf('id="sobre"');
      const next = html.indexOf("<section", start + 1);
      const sobre = html.slice(start, next === -1 ? undefined : next);
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

    // O fato continua sendo o que alguém leu e confirmou; só a composição muda.
    expect(brief("Pizzaria", shouted).businessName.value).toBe("ZEN COMIDA JAPONESA");

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
