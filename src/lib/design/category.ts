import { CATEGORY_GROUPS } from "@/lib/categories";
import { normalizeForMatching } from "@/lib/content-integrity";

export type CategoryId =
  | "food" | "beauty" | "fitness" | "pet" | "auto" | "education" | "retail"
  | "events" | "realestate" | "professional" | "health" | "services"
  | "tourism" | "catalog";

/**
 * Where an unrecognised sector lands.
 *
 * `services` is both a real category and the fallback, and that is deliberate:
 * a local business nobody could classify is, in practice, a local service
 * provider. Inventing a fifteenth "unknown" direction would mean designing a
 * look for a business we know nothing about.
 */
export const FALLBACK_CATEGORY_ID: CategoryId = "services";

/**
 * Maps the operator's free-text sector onto a category.
 *
 * The brief stores `sector` as free text — the wizard offers the group labels
 * as suggestions, but nothing forces the operator to pick one, and no
 * `categoryId` is persisted anywhere. So the match happens here, over
 * normalised text, and it never guesses silently: the resolved direction is
 * shown on the project page before anyone generates a site.
 *
 * Longer keywords are tried first, so "clinica veterinaria" reaches `pet`
 * rather than stopping at `health`'s "clinica".
 */
const MATCHERS: { id: CategoryId; needle: string }[] = CATEGORY_GROUPS.flatMap((group) =>
  [group.label, ...group.keywords].map((term) => ({
    id: group.id as CategoryId,
    needle: normalizeForMatching(term),
  })),
).sort((a, b) => b.needle.length - a.needle.length);

export function resolveCategoryId(sector: string): CategoryId {
  const normalized = normalizeForMatching(sector);
  if (!normalized) return FALLBACK_CATEGORY_ID;

  for (const matcher of MATCHERS) {
    if (normalized.includes(matcher.needle)) return matcher.id;
  }
  return FALLBACK_CATEGORY_ID;
}
