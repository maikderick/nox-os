/**
 * Instagram's own embed feature: the post stays hosted and served by Instagram,
 * with its attribution and profile link. Nothing is copied to our servers, which
 * is what keeps a real photo of the business on the page without republishing
 * someone else's work.
 */
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const SHORTCODE = /^[A-Za-z0-9_-]{5,32}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export const INSTAGRAM_EMBED_LIMIT = 3;

export type InstagramPostRef = {
  shortcode: string;
  kind: "p" | "reel";
};

/**
 * Accepts the URL shapes a person actually copies from the app or the browser.
 * Returns null for anything else — the embed URL is always rebuilt from the
 * parsed shortcode, never from the raw input.
 */
export function parseInstagramPostUrl(value: string): InstagramPostRef | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_000) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // Handles /p/<code>, /reel/<code> and the /<user>/p/<code> variant.
  const markerIndex = segments.findIndex(
    (segment) => segment === "p" || segment === "reel" || segment === "reels",
  );
  if (markerIndex === -1) return null;

  const shortcode = segments[markerIndex + 1] ?? "";
  if (!SHORTCODE.test(shortcode)) return null;

  return {
    shortcode,
    kind: segments[markerIndex] === "p" ? "p" : "reel",
  };
}

export function isInstagramPostUrl(value: string): boolean {
  return parseInstagramPostUrl(value) !== null;
}

/** Canonical embed URL, always rebuilt from the validated shortcode. */
export function instagramEmbedUrl(ref: InstagramPostRef): string {
  return `https://www.instagram.com/${ref.kind === "p" ? "p" : "reel"}/${ref.shortcode}/embed/captioned/`;
}

export function instagramPermalink(ref: InstagramPostRef): string {
  return `https://www.instagram.com/${ref.kind === "p" ? "p" : "reel"}/${ref.shortcode}/`;
}

/** Picks the Instagram profile already captured in the protected snapshot. */
export function findInstagramProfile(socialLinks: readonly string[]): {
  username: string;
  url: string;
} | null {
  for (const link of socialLinks) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) {
      continue;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    if (!first || first === "p" || first === "reel" || first === "reels" || first === "explore") {
      continue;
    }

    const username = first.replace(/^@/, "");
    if (!USERNAME.test(username)) continue;

    return { username, url: `https://www.instagram.com/${username}/` };
  }

  return null;
}
