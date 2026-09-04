import { createHash } from "node:crypto";

import { DIRECTION_CATALOG } from "./catalog";
import { resolveCategoryId } from "./category";
import type { CategoryId } from "./category";

export type Hex = string;

/**
 * The closed font roster.
 *
 * `next/font` resolves at build time, so a direction cannot name an arbitrary
 * family: every face here is declared once in `src/app/sites/[id]/layout.tsx`.
 * Keeping the union closed is what makes "a direction referencing a font that
 * is not loaded" a type error instead of an invisible fallback to Times.
 */
export type FontToken =
  | "fraunces" | "source-serif" | "instrument-serif" | "archivo"
  | "inter-tight" | "inter" | "work-sans" | "dm-mono";

export type Ground = "light" | "dark";
export type Radius = "none" | "sm" | "md" | "lg";
export type Rhythm = "tight" | "regular" | "airy";
export type Scale = "compact" | "regular" | "editorial";
export type MotionMoment = "hero-wordmark" | "hero-image" | "none";

export type Palette = {
  surface: Hex;
  surfaceAlt: Hex;
  ink: Hex;
  inkMuted: Hex;
  line: Hex;
  /**
   * Always a hex, never null. A direction that wants no highlight colour sets
   * this equal to `ink` — `retail` and `events` do, letting the product photo
   * carry the colour. A nullable field would open a second rendering path for
   * a case the value already expresses.
   */
  accent: Hex;
};

export type TypeSpec = {
  display: FontToken;
  body: FontToken;
  scale: Scale;
  displayCase: "none" | "upper";
};

export type ArtDirection = {
  /** Stable and legible in the audit log: "beauty/espelho-latao/v1". */
  id: string;
  categoryId: CategoryId;
  /** The sensory anchor, one line. It is what steers an agent most. */
  anchor: string;
  ground: Ground;
  palette: Palette;
  type: TypeSpec;
  radius: Radius;
  rhythm: Rhythm;
  motion: { moment: MotionMoment; maxMs: number };
  /** The structural device borrowed from the category's own world. */
  device: string;
};

/**
 * Picks one option from an axis, deterministically, from a seed.
 *
 * The axis name is hashed alongside the seed so the axes do not move together:
 * without it, one seed would land on index 0 for palette, type, hero and
 * rhythm at once, and the "space of variants" would collapse back into a
 * handful of fixed templates.
 */
export function pickVariant<T>(options: readonly T[], seed: string, axis: string): T {
  if (options.length === 0) {
    throw new Error(`Não é possível escolher variante de uma lista vazia (eixo "${axis}")`);
  }
  const digest = createHash("sha256").update(`${axis}:${seed}`).digest();
  return options[digest.readUInt32BE(0) % options.length]!;
}

/**
 * The site's whole visual identity, from the sector text and a stable seed.
 *
 * Pure and total: every sector resolves, and the same pair always resolves to
 * the same direction. That is what lets a generated site be reproducible and a
 * preview be trusted as what the agent will build — and it is why no model is
 * in this path.
 */
export function resolveArtDirection(input: { sector: string; seed: string }): ArtDirection {
  const categoryId = resolveCategoryId(input.sector);
  const entry = DIRECTION_CATALOG[categoryId];
  const { seed } = input;

  const paletteIndex = pickVariant(
    entry.palettes.map((_, index) => index), seed, "palette",
  );

  return {
    id: `${categoryId}/${entry.paletteNames[paletteIndex]}/v1`,
    categoryId,
    anchor: entry.anchor,
    ground: entry.ground,
    palette: entry.palettes[paletteIndex]!,
    type: pickVariant(entry.types, seed, "type"),
    radius: entry.radius,
    rhythm: pickVariant(entry.rhythms, seed, "rhythm"),
    motion: entry.motion,
    device: entry.device,
  };
}
