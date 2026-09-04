import { describe, expect, it } from "vitest";

import { ANTI_SLOP_RULES, antiSlopMarkdown, findSlop } from "@/lib/design/anti-slop";

describe("regras anti-slop", () => {
  it("tem as quinze regras da spec, com id único", () => {
    expect(ANTI_SLOP_RULES).toHaveLength(15);
    expect(new Set(ANTI_SLOP_RULES.map((rule) => rule.id)).size).toBe(15);
  });

  it("aprova markup limpo", () => {
    expect(findSlop('<h2 class="text-3xl">Serviços</h2><p>Corte e barba.</p>')).toEqual([]);
  });

  it("pega o eyebrow ALL-CAPS tracked-out", () => {
    const html = '<p class="text-xs font-semibold uppercase tracking-[0.24em]">Sobre</p>';
    expect(findSlop(html).map((r) => r.id)).toContain("eyebrow-caps");
  });

  it("pega o eyebrow ALL-CAPS tracked-out em style inline", () => {
    const html = '<p style="text-transform: uppercase; letter-spacing: 0.18em;">Sobre</p>';
    expect(findSlop(html).map((r) => r.id)).toContain("eyebrow-caps");
  });

  it("não confunde uma wordmark em maiúsculas com um eyebrow", () => {
    const html = '<header class="uppercase tracking-[0.18em]">ACME</header>';
    expect(findSlop(html).map((r) => r.id)).not.toContain("eyebrow-caps");
  });

  it("não confunde um link em maiúsculas com um eyebrow", () => {
    const html = '<a class="uppercase tracking-[0.2em]">Aurora</a>';
    expect(findSlop(html).map((r) => r.id)).not.toContain("eyebrow-caps");
  });

  it("pega gradiente radial de fundo", () => {
    const html = '<section class="bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.14),transparent_34%)]">x</section>';
    expect(findSlop(html).map((r) => r.id)).toContain("gradient-ground");
  });

  it("pega gradiente radial de fundo em style inline", () => {
    const html = '<section style="background: radial-gradient(circle at 85% 20%, rgba(34,211,238,.14), transparent 34%);">x</section>';
    expect(findSlop(html).map((r) => r.id)).toContain("gradient-ground");
  });

  it("não confunde o nome de um arquivo com um gradiente de fundo", () => {
    const html = '<img src="/assets/radial-gradient.svg" alt="Foto do salão">';
    expect(findSlop(html).map((r) => r.id)).not.toContain("gradient-ground");
  });

  it("pega glow em blur/backdrop-filter inline", () => {
    const html = '<div style="filter: blur(40px); position: absolute;">x</div>';
    expect(findSlop(html).map((r) => r.id)).toContain("glow");
  });

  it("pega glow em backdrop-filter blur inline", () => {
    const html = '<div style="backdrop-filter: blur(24px);">x</div>';
    expect(findSlop(html).map((r) => r.id)).toContain("glow");
  });

  it("não confunde o nome de um arquivo com um glow", () => {
    const html = '<img src="/assets/blur-2xl.jpg" alt="Textura">';
    expect(findSlop(html).map((r) => r.id)).not.toContain("glow");
  });

  it("pega glassmorphism", () => {
    const html = '<div class="bg-white/[0.04] backdrop-blur-xl">x</div>';
    expect(findSlop(html).map((r) => r.id)).toContain("glassmorphism");
  });

  it("pega glassmorphism em style inline", () => {
    const html = '<div style="backdrop-filter: blur(20px); background: rgba(255, 255, 255, 0.04);">x</div>';
    expect(findSlop(html).map((r) => r.id)).toContain("glassmorphism");
  });

  it("pega metadado unido por ponto médio", () => {
    expect(findSlop("<span>Rua A, 10 · Centro · Fortaleza</span>").map((r) => r.id))
      .toContain("middle-dot");
  });

  it("pega seta anexada a texto de link", () => {
    expect(findSlop('<a href="/x">Ver serviços →</a>').map((r) => r.id)).toContain("arrow-suffix");
  });

  it("pega quase-preto no lugar de preto", () => {
    expect(findSlop('<div class="bg-[#0B0B0B]">x</div>').map((r) => r.id)).toContain("tinted-black");
  });

  it("pega o atalho hex de três dígitos #111", () => {
    expect(findSlop('<div class="bg-[#111]">x</div>').map((r) => r.id)).toContain("tinted-black");
  });

  it("pega quase-preto com alfa de dois dígitos", () => {
    expect(findSlop('<div style="color:#0a0a0a80">x</div>').map((r) => r.id)).toContain("tinted-black");
  });

  it("não confunde #131313 com um substituto de preto", () => {
    expect(findSlop('<div style="color:#131313">x</div>').map((r) => r.id)).not.toContain("tinted-black");
  });

  it("pega numeração ordinal de conteúdo que não é sequência", () => {
    const html = "<article><span>01</span><h3>Corte</h3></article><article><span>02</span><h3>Barba</h3></article>";
    expect(findSlop(html).map((r) => r.id)).toContain("false-sequence");
  });

  it("reprova o markup do site atual, que é o motivo de as regras existirem", () => {
    const current = `
      <section class="bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.14),transparent_34%)]">
        <p class="text-xs font-semibold uppercase tracking-[0.24em]">Serviços</p>
        <div class="rounded-[2rem] border border-white/10 bg-white/[0.04] backdrop-blur-xl"></div>
        <span>Rua A, 10 · Centro · Fortaleza</span>
      </section>`;
    expect(findSlop(current).length).toBeGreaterThanOrEqual(4);
  });

  it("rende uma seção Don't para o DESIGN.md", () => {
    const markdown = antiSlopMarkdown();
    expect(markdown).toContain("### Don't");
    for (const rule of ANTI_SLOP_RULES) {
      expect(markdown).toContain(rule.text);
    }
  });
});

/**
 * The hero's exception, cornered.
 *
 * The first implementation cut every marked element out of the markup before
 * measuring it, and that turned the marker into a skeleton key: arbitrary slop
 * inside the spotlight passed, five spotlights passed, a marked `<div>` in the
 * footer exempted the footer, `class="x-data-hero-spotlight"` and
 * `data-x="data-hero-spotlight "` both counted as markers, and an element that
 * never closed silenced the linter for the whole document. Every one of those
 * is a case below.
 */
describe("a exceção do hero é uma allowlist, não uma tesoura", () => {
  const SPOTLIGHT =
    '<div data-hero-spotlight="" aria-hidden="true" ' +
    'style="background:radial-gradient(34% 30% at 74% 34%, var(--hero-spotlight), transparent 70%)">' +
    '<svg viewBox="0 0 3787 2842"><ellipse fill="var(--hero-spotlight)"></ellipse></svg></div>';

  const MOTIF =
    '<svg data-category-motif="" data-motif="luz-difusa" aria-hidden="true">' +
    '<style>@media (prefers-reduced-motion:no-preference){[data-motif="luz-difusa"] .r{animation:x 12s}}</style>' +
    '<g style="filter: blur(18px)"><circle></circle></g></svg>';

  /** A page shaped like the real render: one hero, one spotlight, one motif. */
  const page = (inside = `${SPOTLIGHT}${MOTIF}`, after = "") =>
    `<main><header>Aurora</header><section id="inicio" data-hero="" data-hero-ground="dark">` +
    `${inside}<h1>Aurora</h1></section>${after}</main>`;

  const ids = (html: string) => findSlop(html).map((finding) => finding.id);

  it("deixa passar o gradiente do spotlight e o blur do motivo, uma vez cada", () => {
    expect(findSlop(page())).toEqual([]);
  });

  it("reprova um segundo gradiente fora do hero: a exceção é só do hero", () => {
    const html = page(
      SPOTLIGHT,
      '<section id="servicos" style="background: radial-gradient(circle at 20% 20%, white, transparent)">x</section>',
    );
    expect(ids(html)).toContain("gradient-ground");
  });

  it("mede o conteúdo do fragmento: slop dentro do spotlight continua sendo slop", () => {
    // O que a isenção concede é o gradiente e o blur, e nada mais. Um
    // quase-preto, um eyebrow em caixa alta ou um glow de Tailwind escritos
    // dentro do marcador continuam sendo lidos por todas as outras regras.
    const html = page(
      '<div data-hero-spotlight="" style="background:radial-gradient(circle,#fff,transparent);color:#111">' +
        '<p class="uppercase tracking-[0.24em] blur-3xl">Sobre</p></div>',
    );
    expect(ids(html)).toContain("tinted-black");
    expect(ids(html)).toContain("eyebrow-caps");
    expect(ids(html)).not.toContain("gradient-ground");
  });

  it("mede o conteúdo do motivo: o gradiente não está entre as regras concedidas a ele", () => {
    const html = page(
      `${SPOTLIGHT}<svg data-category-motif="" style="filter: blur(9px)">` +
        '<rect style="background:radial-gradient(circle,#fff,transparent)"></rect></svg>',
    );
    expect(ids(html)).toContain("gradient-ground");
    expect(ids(html)).not.toContain("glow");
  });

  it("exige exatamente um spotlight: cinco não são uma exceção", () => {
    const html = page(SPOTLIGHT.repeat(5));
    expect(ids(html)).toContain("spotlight-once");
    // E, sem saber a qual deles a exceção pertence, ninguém a recebe.
    expect(ids(html)).toContain("gradient-ground");
  });

  it("exige exatamente um spotlight: uma página com hero e nenhum reprova", () => {
    expect(ids(page(MOTIF))).toContain("spotlight-once");
  });

  it("aceita no máximo um motivo", () => {
    const html = page(`${SPOTLIGHT}${MOTIF}${MOTIF}`);
    expect(ids(html)).toContain("motif-once");
    expect(ids(html)).toContain("glow");
  });

  it("não isenta um marcador fora do hero", () => {
    const html = page(
      `${SPOTLIGHT}${MOTIF}`,
      '<footer><div data-hero-spotlight="" style="filter:blur(60px);' +
        'background:radial-gradient(circle,white,transparent)"></div></footer>',
    );
    expect(ids(html)).toEqual(
      expect.arrayContaining(["gradient-ground", "glow", "spotlight-once"]),
    );
  });

  it("não isenta um motivo solto, fora de qualquer hero", () => {
    expect(ids(MOTIF)).toContain("glow");
  });

  it("não confunde uma classe com um atributo", () => {
    const html = page(
      `${SPOTLIGHT}${MOTIF}<div class="x-data-hero-spotlight " ` +
        'style="background:radial-gradient(circle,white,transparent)"></div>',
    );
    expect(ids(html)).toContain("gradient-ground");
  });

  it("não confunde o valor de um atributo com o nome dele", () => {
    const html = page(
      `${SPOTLIGHT}${MOTIF}<div data-x="data-hero-spotlight " ` +
        'style="background:radial-gradient(circle,white,transparent)"></div>',
    );
    expect(ids(html)).toContain("gradient-ground");
  });

  it("não isenta um sufixo do marcador", () => {
    const html = page(
      `${SPOTLIGHT}${MOTIF}<div data-hero-spotlight-x="" ` +
        'style="background:radial-gradient(circle,white,transparent)"></div>',
    );
    expect(ids(html)).toContain("gradient-ground");
  });

  it("um motivo aninhado no spotlight reprova, e não apaga o resto da seção", () => {
    // O payload do revisor. Dois fragmentos marcados que se sobrepõem não podem
    // ser recortados do mesmo documento: qualquer ordem de corte mede o segundo
    // contra um texto que o primeiro já encurtou, e a diferença — do tamanho do
    // fragmento interno, que quem escreve o markup controla — sumia sem ser
    // medida em lugar nenhum. Com 400 bytes de enchimento no motivo, uma seção
    // cheia de slop voltava CLEAN.
    const padding = `<!-- ${"-".repeat(400)} -->`;
    const html =
      '<section data-hero="">' +
      '<div data-hero-spotlight="" style="background:radial-gradient(circle,#fff,transparent)">' +
      `<svg data-category-motif=""><g></g>${padding}</svg>` +
      "</div>" +
      '<p style="text-transform: uppercase; letter-spacing: 0.2em">NOSSOS SERVICOS</p>' +
      '<div class="rounded-[2rem]" style="color:#111">🚀 <a>Saiba mais →</a></div>' +
      "</section>";

    expect(ids(html)).toEqual(
      expect.arrayContaining([
        "emoji-icon",
        "radius-soup",
        "eyebrow-caps",
        "arrow-suffix",
        "tinted-black",
        "nested-exception",
      ]),
    );
    // E a concessão cai junto: sem saber quais são os fragmentos, o gradiente do
    // spotlight volta a ser medido como qualquer outro.
    expect(ids(html)).toContain("gradient-ground");
  });

  it("o aninhamento reprova mesmo sem enchimento nenhum", () => {
    const html = page(
      '<div data-hero-spotlight=""><svg data-category-motif=""></svg></div>' +
        '<p style="color:#111">x</p>',
    );
    expect(ids(html)).toContain("nested-exception");
    expect(ids(html)).toContain("tinted-black");
  });

  it("o aninhamento reprova na ordem inversa: spotlight dentro do motivo", () => {
    const html = page(
      '<svg data-category-motif=""><div data-hero-spotlight=""></div></svg>' +
        '<p style="color:#111">x</p>',
    );
    expect(ids(html)).toContain("nested-exception");
    expect(ids(html)).toContain("tinted-black");
  });

  it("pega movimento em hover escondido no <style> global do motivo", () => {
    // O quinto bypass, literal. Um `<style>` dentro de um SVG inline não é
    // escopado ao SVG: vale para o documento inteiro. `motion-budget` não está
    // entre as regras concedidas justamente por isso.
    const hover = '<svg data-category-motif=""><style>a:hover{transition:all .3s}</style></svg>';
    expect(ids(hover)).toContain("motion-budget");
    // E também dentro de um hero legítimo, onde o motivo *tem* concessão.
    expect(ids(page(`${SPOTLIGHT}${hover}`))).toContain("motion-budget");
  });

  it("não confunde a animação legítima do motivo com movimento em hover", () => {
    // O que os catorze motivos declaram é uma `animation:` dentro de um bloco
    // de reduced-motion, nunca um `:hover`. A regra nova não pode pegá-los.
    expect(ids(page())).toEqual([]);
  });

  it("o glow é concedido dentro do spotlight e reprovado fora dele", () => {
    // O par que define a fronteira. Um blur dentro do spotlight é a luz que a
    // reversão liberou; o mesmo blur uma seção abaixo continua sendo glow.
    expect(ids(page('<div data-hero-spotlight="" class="blur-3xl"></div>'))).toEqual([]);
    expect(
      ids(page(SPOTLIGHT, '<section id="servicos" class="blur-3xl">x</section>')),
    ).toContain("glow");
  });

  it("markup desbalanceado reprova, nunca silencia", () => {
    // O pior dos bypasses: uma div marcada sem fechar levava o resto do
    // documento junto e o linter devolvia "limpo" para uma página inteira.
    const html =
      '<section id="inicio" data-hero=""><div data-hero-spotlight="">' +
      '<section id="servicos" style="background: radial-gradient(circle,white,transparent)">' +
      '<div style="filter: blur(40px)"></div></section>';
    expect(ids(html)).toContain("unbalanced-exception");
    expect(ids(html)).toContain("gradient-ground");
    expect(ids(html)).toContain("glow");
  });

  it("recorta o fragmento inteiro, não até o primeiro fechamento aninhado", () => {
    // O motivo aninha `<g>` dentro de `<g>`; um recorte preguiçoso deixaria a
    // cauda do elemento no markup medido.
    const html = page(
      `${SPOTLIGHT}<svg data-category-motif=""><svg></svg>` +
        '<g style="filter: blur(9px)"></g></svg>',
    );
    expect(findSlop(html)).toEqual([]);
  });

  it("o `<style>` global do motivo continua sendo medido pelas outras regras", () => {
    // Um `<style>` dentro de um SVG inline não é escopado ao SVG: vale para o
    // documento inteiro. A isenção do motivo cobre `glow` e o orçamento de
    // movimento; tudo o mais que for escrito ali continua a ser lido.
    const html = page(
      `${SPOTLIGHT}<svg data-category-motif=""><style>.x{color:#111}</style></svg>`,
    );
    expect(ids(html)).toContain("tinted-black");
  });
});
