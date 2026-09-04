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
