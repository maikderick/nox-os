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
 * Rules 1, 2, 8 and 15 were rewritten on 2026-09-04, when the owner reversed
 * them for the hero and only for the hero (spec §13, errata 6). The grant is
 * scoped by markup, not by prose, and it is an allowlist rather than a cut:
 * `findSlop` measures the one `data-hero-spotlight` and the one
 * `<svg data-category-motif>` by all fifteen rules and then drops only the
 * handful each is granted in `FRAGMENT_GRANTS`. Everything about that grant is
 * checked before it is given — it is anchored inside `<section data-hero>`,
 * counted, and required to be disjoint — and the carve-out that separates the
 * fragments from the rest of the document is built forward from the original
 * string, so no cut is ever measured against a document a previous cut already
 * changed. A second gradient one section down still fails, which is the only
 * reason the exception is safe to grant.
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
    text:
      "Sem gradiente radial ou cônico fora do hero. O spotlight do hero é permitido uma vez.",
    // Requires the opening `(` — CSS gradient syntax, never present in a
    // filename like `radial-gradient.svg` — so this covers both
    // `bg-[radial-gradient(...)]` (Tailwind class) and
    // `style="background: radial-gradient(...)"` (inline style) without
    // false-positiving on an `<img src="...radial-gradient.svg">`.
    markup: /(radial|conic)-gradient\(/i,
  },
  {
    id: "glow",
    text: "Sem glow fora do hero e do motivo.",
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
  { id: "two-grounds", text: "No máximo dois chãos: o hero e o corpo." },
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
    text: "Um momento no hero (entrada) + a animação lenta do motivo e do spotlight. Nada anima fora do hero; nada anima ao scroll; nada anima em hover.",
    // Most of this rule is a judgement — a linter cannot count "moments". One
    // clause of it is not: a `:hover` block that moves something is motion on
    // hover, wherever it is written. It is worth a regex because a `<style>`
    // inside an inline SVG is *global* CSS, so hiding a hover transition in
    // the motif's stylesheet would style the whole page from inside the one
    // element the hero's exception touches.
    markup: /:hover\s*\{[^}]*(transition|transform|animation)/i,
  },
];


/**
 * What each granted fragment — and only that fragment — is allowed to trip.
 *
 * The owner's reversal (spec §13, errata 6) grants the hero a radial gradient
 * and a blur, and grants the motif a blur and a slow loop. It grants nothing
 * else. So a fragment is not *hidden* from the rules: it is measured by all
 * fifteen, and only the rules named here are dropped from its result. A `#111`
 * or an ALL-CAPS eyebrow written inside the spotlight is still reported.
 *
 * `motion-budget` is deliberately *not* granted, even though the reversal does
 * grant these two their slow loop. The mechanical half of that rule only sees
 * hover-triggered motion, and neither of them has any: their animation is an
 * `animation:` declaration inside a reduced-motion block. Granting it would
 * have bought nothing and cost the one thing the clause exists to catch — a
 * global `:hover{transition}` smuggled into the motif's `<style>`, which is
 * page-wide CSS despite living inside the SVG.
 */
const FRAGMENT_GRANTS = {
  spotlight: ["gradient-ground", "glow"],
  motif: ["glow"],
} as const;

/**
 * Findings about the *shape* of the exception, not about taste.
 *
 * They are deliberately not members of `ANTI_SLOP_RULES`: that array is the
 * `## Don't` list an agent reads, and "your markup does not close" is not a
 * matter of taste. What they do is make rule 1's promise — "o spotlight do
 * hero é permitido uma vez" — mechanical instead of merely written.
 */
export const HERO_STRUCTURE_FINDINGS = {
  "spotlight-once": "O hero tem exatamente um spotlight, marcado data-hero-spotlight.",
  "motif-once": "O hero tem no máximo um motivo, marcado data-category-motif.",
  "unbalanced-exception":
    "Um elemento marcado como exceção do hero não fecha: o markup não pode ser medido.",
  "nested-exception":
    "Dois elementos marcados como exceção do hero se sobrepõem: cada um é um fragmento, e fragmentos não se aninham.",
} as const;

type StructureFinding = keyof typeof HERO_STRUCTURE_FINDINGS;

/**
 * The attribute *names* on an opening tag, ignoring everything inside a value.
 *
 * A regex over the raw tag cannot do this. `\bdata-hero-spotlight` matches
 * inside `class="x-data-hero-spotlight"`, because `\b` fires after a hyphen;
 * widening the boundary to `["'\s]` then matches inside
 * `data-x="data-hero-spotlight "`, because a value opens with a quote. Both
 * were real bypasses. Walking the tag is the only way to be sure a marker is
 * an attribute and not a substring of somebody's class list.
 */
function attributeNames(tag: string): string[] {
  const body = tag.replace(/^<\/?[a-zA-Z][a-zA-Z0-9]*/, "").replace(/\/?>$/, "");
  const names: string[] = [];
  let index = 0;

  const skipSpace = () => {
    while (index < body.length && /\s/.test(body[index]!)) index += 1;
  };

  while (index < body.length) {
    skipSpace();
    const start = index;
    while (index < body.length && !/[\s=]/.test(body[index]!)) index += 1;
    if (index > start) names.push(body.slice(start, index).toLowerCase());
    skipSpace();
    if (body[index] !== "=") continue;

    index += 1;
    skipSpace();
    const quote = body[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      while (index < body.length && body[index] !== quote) index += 1;
      index += 1;
    } else {
      while (index < body.length && !/\s/.test(body[index]!)) index += 1;
    }
  }
  return names;
}

/** One element's span in the source. `end` is null when it never closes. */
type Fragment = { start: number; end: number | null };

/**
 * Every `<tag>` carrying `attribute`, with the span of its whole subtree.
 *
 * Depth-counted rather than lazily matched to the first closing tag: the
 * motif nests `<g>` inside `<g>`, and a `[\s\S]*?</svg>` would cut at the
 * first inner close and leave the tail of the subtree — the half that carries
 * the blur — in the measured markup.
 */
function markedElements(html: string, tag: string, attribute: string): Fragment[] {
  const tags = [...html.matchAll(new RegExp(`</?${tag}\\b[^>]*>`, "gi"))];
  const found: Fragment[] = [];

  for (let i = 0; i < tags.length; i += 1) {
    const open = tags[i]!;
    if (open[0].startsWith("</")) continue;
    if (!attributeNames(open[0]).includes(attribute)) continue;
    if (open[0].endsWith("/>")) {
      found.push({ start: open.index, end: open.index + open[0].length });
      continue;
    }

    let depth = 1;
    let end: number | null = null;
    for (let j = i + 1; j < tags.length; j += 1) {
      const next = tags[j]!;
      if (next[0].endsWith("/>")) continue;
      depth += next[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = next.index + next[0].length;
        break;
      }
    }
    found.push({ start: open.index, end });
  }
  return found;
}

function matchRules(text: string): { id: string; text: string }[] {
  return ANTI_SLOP_RULES.filter((rule) => rule.markup?.test(text)).map((rule) => ({
    id: rule.id,
    text: rule.text,
  }));
}

export function antiSlopMarkdown(): string {
  return ["### Don't", ...ANTI_SLOP_RULES.map((rule) => `- ${rule.text}`)].join("\n");
}

/**
 * Reports every mechanically checkable rule a piece of rendered HTML trips.
 *
 * The hero's exception is an *allowlist over fragments*, never a blind cut:
 *
 * 1. The grant is anchored. Only a spotlight or a motif inside the
 *    `<section data-hero>` can earn it — a `data-hero-spotlight` in the footer
 *    exempts nothing.
 * 2. The grant is counted. A page with a hero carries exactly one spotlight
 *    and at most one motif; anything else is a finding of its own *and*
 *    revokes the grant, because an exception granted to "the" spotlight cannot
 *    be handed to five of them.
 * 3. The grant is narrow. Each fragment is measured by all fifteen rules; only
 *    the ones named in `FRAGMENT_GRANTS` are dropped from its result.
 * 4. The grant is disjoint. Two marked elements never overlap: each is carved
 *    out of the document as its own span, and a span nested inside another is
 *    a shape this cannot measure. It is reported and revokes the grant.
 * 5. Malformed markup fails loudly. An element that never closes is reported
 *    and the whole document is measured with no grant at all — a linter that
 *    returns "clean" for markup it could not parse is worse than no linter.
 */
export function findSlop(html: string): { id: string; text: string }[] {
  const structure: StructureFinding[] = [];
  const note = (id: StructureFinding) => {
    if (!structure.includes(id)) structure.push(id);
  };

  const heroes = markedElements(html, "section", "data-hero");
  const spotlights = markedElements(html, "div", "data-hero-spotlight");
  const motifs = markedElements(html, "svg", "data-category-motif");

  const unbalanced = [...heroes, ...spotlights, ...motifs].some(
    (fragment) => fragment.end === null,
  );
  if (unbalanced) note("unbalanced-exception");

  const only = heroes.length === 1 ? heroes[0]! : null;
  const hero = only !== null && only.end !== null ? { start: only.start, end: only.end } : null;
  const inHero = (fragment: Fragment) =>
    hero !== null &&
    fragment.end !== null &&
    fragment.start >= hero.start &&
    fragment.end <= hero.end;

  const heroSpotlights = spotlights.filter(inHero);
  const heroMotifs = motifs.filter(inHero);

  // Counted over the whole document, not only over the hero: a second element
  // wearing the marker is a second spotlight wherever it stands, and rule 1
  // grants exactly one. The hero-scoped count catches the other direction — a
  // page whose only spotlight sits outside the hero has none in it.
  if (hero) {
    if (spotlights.length !== 1 || heroSpotlights.length !== 1) note("spotlight-once");
    if (motifs.length > 1 || heroMotifs.length > 1) note("motif-once");
  }

  // Fragments have to be disjoint, and nothing so far makes them so: a motif
  // written *inside* the spotlight passes both counts and lands in `exempt`
  // twice over. Carving overlapping spans out of one string cannot be done —
  // whichever order you cut in, the second cut is measured against a document
  // that no longer matches its own indices, and the difference is document
  // text that silently disappears without being measured anywhere. The size of
  // the hole is the size of the inner fragment, which is written by whoever
  // wrote the markup: an erasure primitive of arbitrary length, inside the one
  // element the exception was supposed to make safe. So overlap is a finding,
  // and it revokes the grant exactly like malformed markup does.
  const spans = [...spotlights, ...motifs]
    .filter((fragment): fragment is { start: number; end: number } => fragment.end !== null)
    .sort((a, b) => a.start - b.start);
  const overlapping = spans.some((fragment, index) =>
    index > 0 ? fragment.start < spans[index - 1]!.end : false,
  );
  if (overlapping) note("nested-exception");

  const granted =
    !unbalanced &&
    !overlapping &&
    hero !== null &&
    heroSpotlights.length === 1 &&
    heroMotifs.length <= 1;

  const exempt: { fragment: Fragment; grant: readonly string[] }[] = granted
    ? [
        ...heroSpotlights.map((fragment) => ({ fragment, grant: FRAGMENT_GRANTS.spotlight })),
        ...heroMotifs.map((fragment) => ({ fragment, grant: FRAGMENT_GRANTS.motif })),
      ]
    : [];

  // The document with the granted fragments carved out, measured by every rule.
  // Built forward, in one pass, from the original string: every index below
  // indexes `html` and nothing else, so no cut can be measured against a
  // document a previous cut already changed.
  const ordered = [...exempt].sort((a, b) => a.fragment.start - b.fragment.start);
  let rest = "";
  let cursor = 0;
  for (const { fragment } of ordered) {
    rest += html.slice(cursor, fragment.start);
    cursor = fragment.end!;
  }
  rest += html.slice(cursor);

  // What came out is exactly the fragments, and nothing else. Unreachable once
  // the spans are disjoint — which is the point of asserting it: if this ever
  // throws, the carve-out has started eating document text again, and a loud
  // failure is the only acceptable way for a linter to be wrong.
  const carved = ordered.reduce(
    (total, { fragment }) => total + (fragment.end! - fragment.start),
    0,
  );
  if (rest.length !== html.length - carved) {
    throw new Error(
      `findSlop: o recorte dos fragmentos do hero perdeu ${
        html.length - carved - rest.length
      } caracteres do documento`,
    );
  }

  const found = matchRules(rest);

  // Then each fragment on its own, minus what it was granted.
  for (const { fragment, grant } of exempt) {
    for (const finding of matchRules(html.slice(fragment.start, fragment.end!))) {
      if (!grant.includes(finding.id)) found.push(finding);
    }
  }

  // One report per rule, in the order the rules are written, then the
  // structural findings — so a caller can compare against a stable list.
  const byId = new Map(found.map((finding) => [finding.id, finding]));
  return [
    ...ANTI_SLOP_RULES.map((rule) => byId.get(rule.id)).filter(
      (finding): finding is { id: string; text: string } => finding !== undefined,
    ),
    ...structure.map((id) => ({ id, text: HERO_STRUCTURE_FINDINGS[id] })),
  ];
}
