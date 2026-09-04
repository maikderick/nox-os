export type WebsiteKind =
  | "none"
  | "owned"
  | "social"
  | "directory"
  | "link_hub"
  | "invalid";

export type WebsiteClassification = {
  kind: WebsiteKind;
  hasOwnWebsite: boolean;
  normalizedUrl: string | null;
  hostname: string | null;
  platform: string | null;
};

type NonOwnedWebsiteRule = {
  domain: string;
  kind: Exclude<WebsiteKind, "none" | "owned" | "invalid">;
  platform?: string;
};

const SOCIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "messenger.com",
  "whatsapp.com",
  "wa.me",
  "tiktok.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "threads.net",
  "pinterest.com",
  "pin.it",
  "snapchat.com",
  "t.me",
  "telegram.me",
  "discord.com",
  "discord.gg",
  "kwai.com",
  "twitch.tv",
  "vimeo.com",
  "reddit.com",
  "tumblr.com",
  "medium.com",
  "substack.com",
  "behance.net",
  "dribbble.com",
  "github.com",
  "soundcloud.com",
  "spotify.com",
  "bsky.app",
  "bluesky.app",
  "vk.com",
] as const;

const LINK_HUB_DOMAINS = [
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "bio.site",
  "campsite.bio",
  "solo.to",
  "taplink.cc",
  "linkin.bio",
  "lnk.bio",
  "msha.ke",
  "milkshake.app",
  "about.me",
  "many.bio",
  "hoo.be",
] as const;

const DIRECTORY_DOMAINS = [
  "g.page",
  "maps.app.goo.gl",
  "maps.apple.com",
  "openstreetmap.org",
  "waze.com",
  "foursquare.com",
  "swarmapp.com",
  "yelp.com",
  "yelp.com.br",
  "tripadvisor.com",
  "tripadvisor.com.br",
  "tripadvisor.pt",
  "guiamais.com.br",
  "telelistas.net",
  "apontador.com.br",
  "solutudo.com.br",
  "hagah.com.br",
  "listaamarela.com.br",
  "brfirmas.org",
  "cnpj.biz",
  "econodata.com.br",
  "consultacnpj.com",
  "doctoralia.com.br",
  "getninjas.com.br",
  "habitissimo.com.br",
  "ifood.com.br",
  "rappi.com.br",
  "ubereats.com",
  "99app.com",
  "mercadolivre.com.br",
  "mercadolivre.com",
  "shopee.com.br",
  "amazon.com.br",
  "olx.com.br",
  "booking.com",
  "airbnb.com",
] as const;

const SHORTENER_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "is.gd",
  "shorturl.at",
  "tiny.one",
] as const;

const NON_OWNED_RULES: readonly NonOwnedWebsiteRule[] = [
  ...SOCIAL_DOMAINS.map((domain) => ({ domain, kind: "social" as const })),
  ...LINK_HUB_DOMAINS.map((domain) => ({ domain, kind: "link_hub" as const })),
  ...DIRECTORY_DOMAINS.map((domain) => ({ domain, kind: "directory" as const })),
  ...SHORTENER_DOMAINS.map((domain) => ({ domain, kind: "link_hub" as const })),
];

const EMPTY_MARKERS = new Set([
  "-",
  "--",
  "n/a",
  "na",
  "none",
  "null",
  "sem site",
  "nao possui",
  "não possui",
  "nao informado",
  "não informado",
]);

const RESERVED_TLDS = new Set(["example", "invalid", "localhost", "local", "test"]);

function emptyClassification(kind: "none" | "invalid"): WebsiteClassification {
  return {
    kind,
    hasOwnWebsite: false,
    normalizedUrl: null,
    hostname: null,
    platform: null,
  };
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeInput(value: string): string {
  return value
    .trim()
    .replace(/&amp;/gi, "&")
    .replace(/^[<({\["']+/, "")
    .replace(/[>)}\]"',;.]+$/, "")
    .trim();
}

function isPublicIpv4(hostname: string): boolean | null {
  if (!/^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;

  const [a, b] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isValidPublicHostname(hostname: string): boolean {
  const ipv4 = isPublicIpv4(hostname);
  if (ipv4 != null) return ipv4;

  // IPv6 literals are uncommon in provider data. Reject local/reserved literals and
  // accept syntactically normalized public literals produced by URL.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const value = hostname.slice(1, -1).toLowerCase();
    return value !== "::" && value !== "::1" && !value.startsWith("fe80:") && !value.startsWith("fc") && !value.startsWith("fd");
  }

  if (hostname.length > 253 || !hostname.includes(".")) return false;
  const labels = hostname.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    return false;
  }

  const tld = labels.at(-1)?.toLowerCase() ?? "";
  if (RESERVED_TLDS.has(tld)) return false;
  return /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(tld);
}

function specialDirectoryPlatform(hostname: string): string | null {
  if (domainMatches(hostname, "google.com") && hostname !== "sites.google.com") {
    return "google";
  }
  if (domainMatches(hostname, "google.com.br")) return "google";
  if (domainMatches(hostname, "bing.com")) return "bing";
  return null;
}

/**
 * Classifies a provider-supplied website without making a network request.
 * Only a valid public HTTP(S) URL outside known social/directory platforms is
 * considered the business's own website.
 */
export function classifyWebsite(value?: string | null): WebsiteClassification {
  if (value == null || !value.trim()) return emptyClassification("none");

  const cleaned = normalizeInput(value);
  if (!cleaned || EMPTY_MARKERS.has(cleaned.toLowerCase())) {
    return emptyClassification("none");
  }

  // A common CSV mistake is putting an email address in the website column.
  if (!/^[a-z][a-z\d+.-]*:/i.test(cleaned) && /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(cleaned)) {
    return emptyClassification("invalid");
  }

  const candidate = cleaned.startsWith("//")
    ? `https:${cleaned}`
    : /^[a-z][a-z\d+.-]*:/i.test(cleaned)
      ? cleaned
      : `https://${cleaned}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return emptyClassification("invalid");
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return emptyClassification("invalid");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isValidPublicHostname(hostname)) return emptyClassification("invalid");

  url.hash = "";
  const normalizedUrl = url.toString();
  const specialDirectory = specialDirectoryPlatform(hostname);
  if (specialDirectory) {
    return {
      kind: "directory",
      hasOwnWebsite: false,
      normalizedUrl,
      hostname,
      platform: specialDirectory,
    };
  }

  const nonOwned = NON_OWNED_RULES.find((rule) => domainMatches(hostname, rule.domain));
  if (nonOwned) {
    return {
      kind: nonOwned.kind,
      hasOwnWebsite: false,
      normalizedUrl,
      hostname,
      platform: nonOwned.platform ?? nonOwned.domain,
    };
  }

  return {
    kind: "owned",
    hasOwnWebsite: true,
    normalizedUrl,
    hostname,
    platform: null,
  };
}

export function hasOwnWebsite(value?: string | null): boolean {
  return classifyWebsite(value).hasOwnWebsite;
}

export function isLeadEligibleByWebsite(value?: string | null): boolean {
  return !hasOwnWebsite(value);
}

/** Returns a normalized host only for an actual business website. */
export function normalizeWebsiteDomain(value?: string | null): string | null {
  const classification = classifyWebsite(value);
  if (!classification.hasOwnWebsite || !classification.hostname) return null;
  return classification.hostname.replace(/^www\d*\./, "");
}
