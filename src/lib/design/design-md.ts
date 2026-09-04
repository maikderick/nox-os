import type { ArtDirection } from "./art-direction";
import { antiSlopMarkdown } from "./anti-slop";
import { RADIUS_PX, RHYTHM_SPACE, SCALE_STEPS, resolveHeroPalette, toCssVariables } from "./tokens";

const FONT_STACK: Record<string, string> = {
  fraunces: "Fraunces, Georgia, serif",
  "source-serif": "'Source Serif 4', Georgia, serif",
  "instrument-serif": "'Instrument Serif', Georgia, serif",
  archivo: "Archivo, 'Helvetica Neue', sans-serif",
  "inter-tight": "'Inter Tight', 'Helvetica Neue', sans-serif",
  inter: "Inter, 'Helvetica Neue', sans-serif",
  "work-sans": "'Work Sans', 'Helvetica Neue', sans-serif",
  "dm-mono": "'DM Mono', 'SFMono-Regular', monospace",
};

const COLOR_ROLES: [keyof ArtDirection["palette"], string, string][] = [
  ["surface", "--surface", "Fundo da página. Um chão só, do topo ao rodapé."],
  ["surfaceAlt", "--surface-alt", "Segundo plano, para separar uma seção sem trocar o chão."],
  ["ink", "--ink", "Texto e títulos."],
  ["inkMuted", "--ink-muted", "Texto secundário. Nunca abaixo de 4.5:1 sobre o fundo."],
  ["line", "--line", "Bordas e divisores."],
  ["accent", "--accent", "Único destaque. No máximo 5% da superfície."],
];

/**
 * The direction as a DESIGN.md.
 *
 * The format is the one coding agents already consume well, and it is what the
 * reference the studio works from recommends: the DESIGN.md carries taste, the
 * brief carries facts. Nothing about the client appears here — this half of the
 * prompt is a studio decision and says nothing a business would have to confirm.
 */
export function toDesignMarkdown(direction: ArtDirection): string {
  const { palette, type } = direction;
  const space = RHYTHM_SPACE[direction.rhythm];
  const steps = SCALE_STEPS[type.scale];
  const vars = toCssVariables(direction);
  const hero = resolveHeroPalette(direction);
  // Instrument Serif ships one real weight; asking it for 700 gets a
  // synthesized bold, so the headline of a direction on that face stays at 400.
  const heroWeight = type.display === "instrument-serif" ? 400 : 700;

  /**
   * The `:root` block below has a different reader than `toCssVariables`'s
   * caller. The preview renders inside NOX OS, where `next/font` has already
   * declared `--font-inter-tight` and friends — so `vars["--font-display"]`
   * pointing at `var(--font-inter-tight)` resolves there. This Markdown ships
   * to a coding agent building the client's own site, where no such variable
   * exists: it would have to guess a typeface from a reference to nothing. So
   * this is the one deliberate substitution — the two font properties resolve
   * through the same `FONT_STACK` the `## Tokens — Typography` section above
   * already uses, everything else still comes straight from `toCssVariables`.
   */
  const rootVars: Record<string, string> = {
    ...vars,
    "--font-display": FONT_STACK[type.display],
    "--font-body": FONT_STACK[type.body],
  };

  const lines: string[] = [
    `# Style Reference`,
    `> ${direction.anchor}`,
    ``,
    `**Theme:** ${direction.ground}`,
    ``,
    `A direção nasce do mundo do próprio negócio, não de um gosto genérico. O`,
    `dispositivo estrutural é \`${direction.device}\`, e é ele que organiza a`,
    `página — não uma sequência de cartões iguais.`,
    ``,
    `## Tokens — Colors`,
    ``,
    `| Name | Value | Token | Role |`,
    `| --- | --- | --- | --- |`,
    ...COLOR_ROLES.map(([key, token, role]) => `| ${key} | \`${palette[key]}\` | \`${token}\` | ${role} |`),
    ``,
    `## Tokens — Typography`,
    ``,
    `### Display — \`--font-display\``,
    `- **Family:** ${FONT_STACK[type.display]}`,
    `- **Case:** ${type.displayCase === "upper" ? "caixa alta" : "caixa natural"}`,
    ``,
    `### Body — \`--font-body\``,
    `- **Family:** ${FONT_STACK[type.body]}`,
    `- **Line length:** máximo 72 caracteres.`,
    ``,
    `### Type Scale`,
    ``,
    `| Role | Size | Line Height | Letter Spacing | Token |`,
    `| --- | --- | --- | --- | --- |`,
    ...steps.map((s) => `| ${s.role} | ${s.size} | ${s.leading} | ${s.tracking} | \`--text-${s.role}\` |`),
    ``,
    `Quatro tamanhos, três pesos. Não acrescente um quinto.`,
    ``,
    `## Tokens — Spacing & Shapes`,
    ``,
    `**Density:** ${direction.rhythm}`,
    ``,
    `| Name | Value | Token |`,
    `| --- | --- | --- |`,
    `| section | ${space.section} | \`--space-section\` |`,
    `| block | ${space.block} | \`--space-block\` |`,
    `| inline | ${space.inline} | \`--space-inline\` |`,
    ``,
    `### Border Radius`,
    ``,
    `\`${RADIUS_PX[direction.radius]}\` em tudo. Um raio por site.`,
    ``,
    `### Shadows`,
    ``,
    `Nenhuma. A hierarquia vem de espaço, peso e linha.`,
    ``,
    `## Components`,
    ``,
    `- **Navbar** — nome do negócio à esquerda, âncoras à direita, um CTA. Sem blur, sem transparência.`,
    `- **Hero** — contrato próprio, na seção abaixo. Um CTA primário, um só.`,
    `- **Services** — cada serviço tem nome, resumo e corpo confirmados. Sem ícone decorativo.`,
    `- **Contact** — só os canais confirmados. Um canal ausente não vira placeholder.`,
    `- **Footer** — nome, contato, e nada mais.`,
    ``,
    `### Hero`,
    ``,
    `A abertura ocupa a dobra: \`min-height: 88vh\` no desktop, altura natural no`,
    `celular. Duas colunas (\`1.1fr 0.9fr\`) a partir de 900px, uma só abaixo disso.`,
    ``,
    hero.ground === direction.ground
      ? `- **Chão** — \`--hero-surface\`, o mesmo do corpo. Um chão só nesta direção.`
      : `- **Chão** — \`--hero-surface\` é preto puro sob um corpo claro. São os dois chãos permitidos, e não existe um terceiro.`,
    `- **Título** — \`<h1>\` em \`--font-display\`, \`clamp(2.6rem, 6.5vw, 6rem)\` no desktop e \`clamp(2.6rem, 12vw, 4rem)\` no celular, \`line-height: 0.95\`, peso ${heroWeight}, cor \`--hero-ink\`. O impacto vem do tamanho: nada de gradiente nas letras.`,
    `- **O nome não se parte** — \`hyphens: manual\`, \`overflow-wrap: normal\`, \`word-break: normal\`: um nome de negócio quebra no espaço ou não quebra. Se o termo mais longo não couber na coluna, quem cede é o tamanho, nunca a palavra.`,
    `- **Frase** — uma só, a de posicionamento, em \`--hero-ink-muted\`, \`max-width: 34ch\`.`,
    `- **Spotlight** — uma única elipse borrada em \`--hero-spotlight\`, no elemento marcado \`data-hero-spotlight\`, com entrada de 2s uma vez. É a única luz da página; não repita em outra seção.`,
    `- **Objeto** — à direita, um SVG inline desenhado do mundo da categoria (motivo \`${direction.hero.motif}\`), \`aria-hidden\`, marcado \`data-category-motif\`, com uma animação lenta de 8 a 14s. Sem foto de banco, sem cena 3D, sem ilustração genérica.`,
    `- **CTA** — um só, no hero: borda \`1px solid var(--hero-accent)\`, texto \`--hero-ink\`, sem preenchimento.`,
    `- **\`--hero-accent\`** — o acento da direção, ou a tinta do hero quando o acento não alcança 2:1 contra \`--hero-surface\`. Dentro do hero use este token, nunca \`--accent\`: em duas categorias o acento é igual à tinta e sumiria no chão preto.`,
    `- **Cabeçalho** — fica no chão do hero (\`--hero-surface\`, texto \`--hero-ink\`), não no do corpo: uma faixa clara sobre um hero preto vira um terceiro chão.`,
    `- **Depois do hero** — a página volta para \`--surface\` e não anima mais nada.`,
    `- **No celular** — uma coluna, o objeto por último e menor: a abertura inteira cabe na dobra.`,
    ``,
    `## Do's and Don'ts`,
    ``,
    `### Do`,
    `- Deixe a tipografia carregar a personalidade.`,
    `- Use \`--accent\` uma vez por tela, no que mais importa.`,
    `- Deixe respiro: \`--space-section\` entre seções, sempre.`,
    `- Estruture com o dispositivo da direção, não com cartões genéricos.`,
    `- Garanta foco de teclado visível e \`prefers-reduced-motion\`.`,
    ``,
    antiSlopMarkdown(),
    ``,
    `## Motion`,
    ``,
    direction.motion.moment === "none"
      ? `Nenhum movimento de entrada. Só estados de foco e de formulário.`
      : `Um único momento: \`${direction.motion.moment}\`, no carregamento, até ${direction.motion.maxMs}ms, opacidade e no máximo 2px de deslocamento.`,
    `No hero, além disso: a entrada única do spotlight (2s) e a animação lenta do motivo (8 a 14s).`,
    `Fora do hero nada anima — nem ao scroll, nem em hover. Respeite \`prefers-reduced-motion\`.`,
    ``,
    `## Agent Prompt Guide`,
    ``,
    `### Quick Color Reference`,
    `- Fundo: \`${palette.surface}\` · segundo plano: \`${palette.surfaceAlt}\``,
    `- Texto: \`${palette.ink}\` · secundário: \`${palette.inkMuted}\``,
    `- Borda: \`${palette.line}\` · acento: \`${palette.accent}\``,
    ``,
    `## Quick Start`,
    ``,
    `### CSS Custom Properties`,
    ``,
    "```css",
    `:root {`,
    ...Object.entries(rootVars).map(([key, value]) => `  ${key}: ${value};`),
    `}`,
    "```",
    ``,
    `### Tailwind v4`,
    ``,
    "```css",
    `@theme {`,
    `  --color-surface: ${palette.surface};`,
    `  --color-surface-alt: ${palette.surfaceAlt};`,
    `  --color-ink: ${palette.ink};`,
    `  --color-ink-muted: ${palette.inkMuted};`,
    `  --color-line: ${palette.line};`,
    `  --color-accent: ${palette.accent};`,
    `  --radius-base: ${RADIUS_PX[direction.radius]};`,
    `}`,
    "```",
  ];

  return lines.join("\n");
}
