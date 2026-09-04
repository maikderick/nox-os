import type { ArtDirection } from "./art-direction";
import { antiSlopMarkdown } from "./anti-slop";
import { RADIUS_PX, RHYTHM_SPACE, SCALE_STEPS, toCssVariables } from "./tokens";

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
    `- **Hero** — o dispositivo \`${direction.device}\` manda aqui. Um CTA primário, um só.`,
    `- **Services** — cada serviço tem nome, resumo e corpo confirmados. Sem ícone decorativo.`,
    `- **Contact** — só os canais confirmados. Um canal ausente não vira placeholder.`,
    `- **Footer** — nome, contato, e nada mais.`,
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
    `Fora isso, movimento só responde a uma ação da pessoa. Respeite \`prefers-reduced-motion\`.`,
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
