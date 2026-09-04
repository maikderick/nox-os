import type { CSSProperties } from "react";

import type { ArtDirection, Radius, Rhythm, Scale } from "./art-direction";

export const RADIUS_PX: Record<Radius, string> = {
  none: "0px", sm: "4px", md: "10px", lg: "20px",
};

export const RHYTHM_SPACE: Record<Rhythm, { section: string; block: string; inline: string }> = {
  tight: { section: "4rem", block: "1.5rem", inline: "1.25rem" },
  regular: { section: "6rem", block: "2rem", inline: "1.5rem" },
  airy: { section: "9rem", block: "3rem", inline: "2rem" },
};

/** At most four sizes, per anti-slop rule `type-soup`. */
export const SCALE_STEPS: Record<
  Scale,
  { role: string; size: string; leading: string; tracking: string }[]
> = {
  compact: [
    { role: "display", size: "3.25rem", leading: "1.02", tracking: "-0.02em" },
    { role: "heading", size: "1.5rem", leading: "1.2", tracking: "-0.01em" },
    { role: "body", size: "1rem", leading: "1.6", tracking: "0" },
    { role: "small", size: "0.875rem", leading: "1.5", tracking: "0" },
  ],
  regular: [
    { role: "display", size: "3.75rem", leading: "1.05", tracking: "-0.015em" },
    { role: "heading", size: "1.75rem", leading: "1.25", tracking: "-0.005em" },
    { role: "body", size: "1.0625rem", leading: "1.65", tracking: "0" },
    { role: "small", size: "0.9375rem", leading: "1.55", tracking: "0" },
  ],
  editorial: [
    { role: "display", size: "4.5rem", leading: "1.0", tracking: "-0.01em" },
    { role: "heading", size: "2rem", leading: "1.3", tracking: "0" },
    { role: "body", size: "1.125rem", leading: "1.75", tracking: "0" },
    { role: "small", size: "1rem", leading: "1.6", tracking: "0" },
  ],
};

/**
 * The direction as custom properties.
 *
 * These are the same values `toDesignMarkdown` writes into the agent's
 * `Quick Start`. Both read this function's output, so the preview and the
 * generated site cannot drift apart through a typo in prose.
 */
export function toCssVariables(direction: ArtDirection): Record<string, string> {
  const space = RHYTHM_SPACE[direction.rhythm];
  const steps = SCALE_STEPS[direction.type.scale];

  const vars: Record<string, string> = {
    "--surface": direction.palette.surface,
    "--surface-alt": direction.palette.surfaceAlt,
    "--ink": direction.palette.ink,
    "--ink-muted": direction.palette.inkMuted,
    "--line": direction.palette.line,
    "--accent": direction.palette.accent,
    "--radius": RADIUS_PX[direction.radius],
    "--space-section": space.section,
    "--space-block": space.block,
    "--space-inline": space.inline,
    "--font-display": `var(--font-${direction.type.display})`,
    "--font-body": `var(--font-${direction.type.body})`,
    "--motion-max":
      direction.motion.moment === "none" ? "0ms" : `${direction.motion.maxMs}ms`,
  };

  for (const step of steps) {
    vars[`--text-${step.role}`] = step.size;
    vars[`--leading-${step.role}`] = step.leading;
    vars[`--tracking-${step.role}`] = step.tracking;
  }
  return vars;
}

/** The same map, typed for a React `style` prop. */
export function toStyleAttribute(direction: ArtDirection): CSSProperties {
  return toCssVariables(direction) as CSSProperties;
}
