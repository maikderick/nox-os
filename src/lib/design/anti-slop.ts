/**
 * The visual counterpart to `content-integrity.ts`.
 *
 * That module keeps invented *claims* off a page — awards, testimonials, years
 * in business. These rules keep the page from looking generated: the traits
 * that appear on an AI-built site whatever the subject is.
 *
 * One source, two consumers. `antiSlopMarkdown()` writes the `## Don't` section
 * the agent reads; `findSlop()` asserts over the preview's rendered markup. A
 * rule stated to the agent but unenforced in our own renderer would be a rule
 * we do not believe.
 *
 * Rules 10 to 13 exist because the markup they describe was in this repository.
 *
 * `markup` regexes cover both the Tailwind-class form and the React inline
 * `style` attribute form, because the site renderer emits inline styles: a
 * rule that only matched Tailwind class patterns would pass trivially against
 * the markup it exists to catch.
 */
export type AntiSlopRule = {
  id: string;
  text: string;
  /** Present when the rule is mechanically checkable over rendered HTML. */
  markup?: RegExp;
};

export const ANTI_SLOP_RULES: AntiSlopRule[] = [
  {
    id: "gradient-ground",
    text: "Sem gradiente radial ou cônico como fundo de seção.",
    // Requires the opening `(` — CSS gradient syntax, never present in a
    // filename like `radial-gradient.svg` — so this covers both
    // `bg-[radial-gradient(...)]` (Tailwind class) and
    // `style="background: radial-gradient(...)"` (inline style) without
    // false-positiving on an `<img src="...radial-gradient.svg">`.
    markup: /(radial|conic)-gradient\(/i,
  },
  {
    id: "glow",
    text: "Sem glow: nenhum elemento borrado atrás do conteúdo.",
    // Tailwind: `blur-2xl`/`blur-3xl` utility classes (the negative
    // lookbehind rejects a preceding `/`, word char, or `-`, so a path
    // segment like `/assets/blur-2xl.jpg` cannot match while a class token,
    // preceded by a space or quote, still can), or a `shadow-[0_0_...]`
    // arbitrary glow shadow. Inline: `filter:` or `backdrop-filter:` followed
    // by `blur(` in a `style` attribute — one alternation covers both
    // because it is unanchored and `backdrop-filter: blur(` always contains
    // `filter: blur(` as a substring.
    markup: /(?<![\/\w-])blur-(2xl|3xl)\b|shadow-\[0_0_\d|filter:\s*blur\(/i,
  },
  {
    id: "glassmorphism",
    text: "Sem glassmorphism como estilo de card.",
    // Tailwind: `bg-white/[0.0x]` co-occurring with `backdrop-blur` in the
    // same class attribute, in either order. Inline: `backdrop-filter`
    // co-occurring with a low-alpha `rgba(255, 255, 255, 0.0x)` background
    // in the same style attribute, in either order.
    markup:
      /bg-white\/\[?0?\.0\d\]?[^"']*backdrop-blur|backdrop-blur[^"']*bg-white\/\[?0?\.0|backdrop-filter[^"']*rgba\(255,\s*255,\s*255,\s*0?\.0\d|rgba\(255,\s*255,\s*255,\s*0?\.0\d[^"']*backdrop-filter/i,
  },
  { id: "accent-flood", text: "Um acento só por site, em no máximo 5% da superfície." },
  {
    id: "emoji-icon",
    text: "Sem emoji como ícone e sem grade de ícone genérica.",
    markup: /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u,
  },
  {
    // In this design every radius comes from `var(--radius)`, set once by the
    // art direction. A hardcoded arbitrary-value radius (`rounded-[...]`) is
    // by definition outside that token system — it is a violation on its
    // own, whether or not a second, different radius also appears on the
    // page. So this flags any occurrence, not just a pair of mismatched ones.
    id: "radius-soup",
    text: "Um raio por site. Nada de rounded-[2rem] ao lado de rounded-lg.",
    markup: /rounded-\[\d/,
  },
  { id: "type-soup", text: "No máximo quatro tamanhos e três pesos de tipo." },
  { id: "two-grounds", text: "Um chão por site. Nada de hero escuro sobre corpo claro." },
  { id: "cta-crowd", text: "Um CTA primário por viewport." },
  {
    id: "eyebrow-caps",
    text: "Sem eyebrow ALL-CAPS tracked-out acima de seção.",
    // An eyebrow label lives in a `<p>` or `<span>` above a section; a
    // wordmark or nav link set in caps (e.g. `<header>`, `<h1>`, `<a>`) is
    // not the pattern this rule forbids. Each alternation is anchored on the
    // opening `<p`/`<span` tag first, so the class/style match below is only
    // checked within that one element's attributes. Tailwind: `uppercase`
    // co-occurring with `tracking-[0.15em]` or wider in the same class
    // attribute, in either order. Inline: `text-transform: uppercase`
    // co-occurring with `letter-spacing: 0.15em` or wider in the same style
    // attribute, in either order.
    markup:
      /<(?:p|span)\b[^>]*uppercase[^"']*tracking-\[0\.(1[5-9]|[2-9])|<(?:p|span)\b[^>]*tracking-\[0\.(1[5-9]|[2-9])[^"']*uppercase|<(?:p|span)\b[^>]*text-transform:\s*uppercase[^"']*letter-spacing:\s*0?\.(1[5-9]|[2-9])\d*em|<(?:p|span)\b[^>]*letter-spacing:\s*0?\.(1[5-9]|[2-9])\d*em[^"']*text-transform:\s*uppercase/i,
  },
  {
    id: "false-sequence",
    text: "Sem numeração 01/02/03 sobre conteúdo que não é sequência.",
    markup: /<span[^>]*>\s*0[123]\s*<\/span>/,
  },
  {
    id: "middle-dot",
    text: "Sem metadado unido por ponto médio.",
    markup: /\S\s+·\s+\S/,
  },
  {
    id: "arrow-suffix",
    text: "Sem seta anexada a texto de link ou botão.",
    markup: /[\p{L}\p{N}]\s*(→|-&gt;|&rarr;)\s*<\//u,
  },
  {
    id: "tinted-black",
    text: "Preto é #000000. Nada de #0B0B0B ou #111 como substituto.",
    // The three-digit shorthand (`#111`), every near-black neutral from
    // `#0a0a0a` to `#121212`, each optionally followed by a two-digit alpha
    // (`#0a0a0a80`). `#131313` and darker-but-distinct neutrals are not
    // matched — this is the specific band of greys this codebase has used as
    // a black substitute, not "any dark color".
    markup:
      /#(?:111|0a0a0a|0b0b0b|0c0c0c|0d0d0d|0e0e0e|0f0f0f|101010|111111|121212)(?:[0-9a-f]{2})?\b/i,
  },
  {
    id: "motion-budget",
    text: "Um momento de movimento por site, no hero, até 200ms. Fora isso, movimento só responde a ação da pessoa.",
  },
];

export function antiSlopMarkdown(): string {
  return ["### Don't", ...ANTI_SLOP_RULES.map((rule) => `- ${rule.text}`)].join("\n");
}

/** Reports every mechanically checkable rule a piece of rendered HTML trips. */
export function findSlop(html: string): { id: string; text: string }[] {
  return ANTI_SLOP_RULES.filter((rule) => rule.markup?.test(html)).map((rule) => ({
    id: rule.id,
    text: rule.text,
  }));
}
