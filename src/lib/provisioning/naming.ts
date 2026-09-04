/**
 * Names the factory gives to things it creates elsewhere.
 *
 * They are derived, never typed by hand: a name that a person invents once is a
 * name nobody can reconstruct later, and every step here has to be able to look
 * up what a previous run created.
 */

/**
 * The one job name in the template's CI workflow.
 *
 * `typecheck`, `lint`, `build` and the end-to-end steps are *steps inside* this
 * job and do not exist as checks for the GitHub API. Requiring them by name
 * would leave branch protection waiting for checks that never arrive.
 */
export const REQUIRED_CHECK = "verify";

export const SITE_TEMPLATE = {
  owner: process.env.NOX_SITE_TEMPLATE_OWNER ?? "maikderick",
  repo: process.env.NOX_SITE_TEMPLATE_REPO ?? "nox-site-template",
} as const;

/** The GitHub organization that holds only generated client sites. */
export function sitesOwnerFallback(): string {
  return process.env.NOX_SITES_ORG ?? "nox-sites-falso";
}

function slugSegment(value: string, max: number): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036F]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "site"
  );
}

/**
 * `site-<client slug>`. The client slug is already unique per organization; two
 * organizations can still collide, which is why the repository name is checked
 * for availability before creation rather than assumed to be free.
 */
export function repositoryNameFor(clientSlug: string): string {
  return `site-${slugSegment(clientSlug, 80)}`;
}

/**
 * Vercel is stricter than GitHub about length and characters, so the hosting
 * name is derived separately and kept shorter rather than reusing the
 * repository name and hoping it fits.
 */
export function hostingProjectNameFor(clientSlug: string): string {
  return slugSegment(`site-${clientSlug}`, 52);
}
