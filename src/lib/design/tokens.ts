import type { CSSProperties } from "react";

import type { ArtDirection, Ground, Hex, Radius, Rhythm, Scale } from "./art-direction";

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

/** Rule 5 — when the hero asks for black, it is black, not a tinted near-black. */
const HERO_DARK_SURFACE = "#000000";

/** The muted hero tone: 70% of the hero ink, per the brief. */
const HERO_MUTED_FACTOR = 0.7;

/**
 * The floor the accent must clear against the hero ground to stay the accent.
 *
 * Lower than the 3:1 the catalog test demands on the body surfaces, and
 * deliberately so: there the accent is a UI fill the site-kit paints controls
 * with, here it is a large decorative shape inside the motif. What this floor
 * actually guards against is the accent *disappearing* — `retail` (`#000000`)
 * and `events` (`#17171A`) set their accent to the ink, and on a black hero
 * that is an invisible object. Those two fall back to the hero ink, which is
 * the same thing their body already does: on those directions the accent
 * reads as an ink mark, and that is the direction speaking.
 */
const HERO_ACCENT_MIN_CONTRAST = 2;

function srgbChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a six-digit hex. Every palette value is one. */
function luminance(hex: Hex): number {
  const r = srgbChannel(parseInt(hex.slice(1, 3), 16));
  const g = srgbChannel(parseInt(hex.slice(3, 5), 16));
  const b = srgbChannel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** A hex scaled towards black by `factor`, channel by channel. */
function dim(hex: Hex, factor: number): Hex {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((pair) =>
    Math.round(parseInt(pair, 16) * factor)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase(),
  );
  return `#${channels.join("")}`;
}

export type HeroPalette = {
  ground: Ground;
  surface: Hex;
  ink: Hex;
  inkMuted: Hex;
  accent: Hex;
  /** Colour *and* alpha of the single spotlight. Never a solid fill. */
  spotlight: string;
};

/**
 * The hero's four colours, derived — never authored a second time.
 *
 * A direction whose hero inherits reuses the page's own surface and inks, so
 * the derivation is a no-op and there is exactly one ground on the page. A
 * direction whose hero is `dark` opens on pure black and *inverts*: the light
 * surface the body stands on becomes the ink the hero writes with, and the
 * muted tone is that same colour at 70%. Nothing here invents a colour the
 * palette does not already contain, which is what keeps a fourteen-category
 * catalog from needing twenty-eight palettes.
 */
export function resolveHeroPalette(direction: ArtDirection): HeroPalette {
  const { palette } = direction;
  const inherits = direction.hero.ground === "inherit";
  const ground: Ground = inherits ? direction.ground : "dark";

  const surface = inherits ? palette.surface : HERO_DARK_SURFACE;
  const ink = inherits ? palette.ink : palette.surface;
  const inkMuted = inherits ? palette.inkMuted : dim(palette.surface, HERO_MUTED_FACTOR);

  return {
    ground,
    surface,
    ink,
    inkMuted,
    accent:
      contrastRatio(palette.accent, surface) >= HERO_ACCENT_MIN_CONTRAST
        ? palette.accent
        : ink,
    // On black the light is white at 20%, as in the reference. On a light
    // ground the accent was tried there and read as a stain, not as light: a
    // hue carries far more weight over white than a neutral does over black,
    // and the eye reads a large tinted area as dirt in the image rather than
    // as a source. So the light ground gets the direction's own ink at 6% —
    // a neutral shadow-side, which is what light on a pale surface actually
    // looks like. The geometry answers too, in the hero stylesheet.
    spotlight: ground === "dark" ? "#FFFFFF33" : `${palette.ink}0F`,
  };
}

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
  const hero = resolveHeroPalette(direction);

  const vars: Record<string, string> = {
    "--surface": direction.palette.surface,
    "--surface-alt": direction.palette.surfaceAlt,
    "--ink": direction.palette.ink,
    "--ink-muted": direction.palette.inkMuted,
    "--line": direction.palette.line,
    "--accent": direction.palette.accent,
    // The hero's own four. On an inheriting direction they are the page's,
    // so a renderer can address the hero through them unconditionally.
    "--hero-surface": hero.surface,
    "--hero-ink": hero.ink,
    "--hero-ink-muted": hero.inkMuted,
    "--hero-accent": hero.accent,
    "--hero-spotlight": hero.spotlight,
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
