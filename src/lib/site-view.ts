import "server-only";

import { cache } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js";

import { prisma } from "@/lib/db";
import { isDemoLandingExpired } from "@/lib/demo-landing";
import { captureLegacyDemoBusinessSnapshot } from "@/lib/demo-landing-store";
import {
  isSafeDemoImageUrl,
  normalizeDemoCtaLabel,
  parseDemoLandingContent,
  type DemoBusinessSnapshot,
  type DemoLandingContent,
} from "@/lib/demo-landing-schema";
import { isValidPhoneE164 } from "@/lib/phone";
import { sectorFamily, type SectorFamily } from "@/lib/site-generator";
import { hasOwnWebsite } from "@/lib/website";
import { buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * Everything a public site page needs, resolved once per request.
 *
 * The site is the DemoLanding record rendered as a real multi-page site. It
 * stays gated exactly like the old single page: only an approved, unexpired
 * record for a business without its own website is served.
 */
export type SiteView = {
  slug: string;
  content: DemoLandingContent;
  business: DemoBusinessSnapshot;
  family: SectorFamily;
  expiresAt: Date;
  isPermanent: boolean;
  theme: SiteTheme;
  base: string;
  nav: { href: string; label: string }[];
  whatsapp: { href: string; display: string } | null;
  phone: { href: string; display: string } | null;
  cta: { href: string; label: string; external: boolean };
  address: string | null;
  locationShort: string | null;
  map: { embed: string; external: string } | null;
  socialLinks: { href: string; label: string }[];
  heroImage: string | null;
  menuLabel: string;
};

export type SiteTheme = {
  mode: "dark" | "light";
  bg: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  onPrimary: string;
};

export type SiteAvailability =
  | { ok: true; site: SiteView }
  | { ok: false; reason: "missing" | "expired" | "unavailable" };

const getRecord = cache(async (slug: string) =>
  prisma.demoLanding.findUnique({ where: { slug }, include: { business: true } }),
);

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(base: string, tint: string, ratio: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(tint);
  return `#${a
    .map((channel, index) => Math.round(channel * (1 - ratio) + b[index] * ratio).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function buildTheme(content: DemoLandingContent): SiteTheme {
  const mode = content.theme;
  const primary = content.primaryColor;
  const accent = content.accentColor;
  if (mode === "light") {
    return {
      mode,
      bg: mix("#ffffff", primary, 0.02),
      surface: "#ffffff",
      surfaceStrong: mix("#f6f6f8", primary, 0.06),
      border: mix("#e6e7eb", primary, 0.08),
      text: "#14151a",
      muted: "#5c6070",
      primary,
      accent,
      onPrimary: luminance(primary) > 0.5 ? "#101114" : "#ffffff",
    };
  }
  return {
    mode,
    bg: mix("#0a0a0d", primary, 0.08),
    surface: mix("#131318", primary, 0.06),
    surfaceStrong: mix("#1b1b22", primary, 0.1),
    border: mix("#2a2a33", primary, 0.12),
    text: "#f6f6f8",
    muted: "#a5a8b5",
    primary,
    accent,
    onPrimary: luminance(primary) > 0.5 ? "#101114" : "#ffffff",
  };
}

export function themeStyle(theme: SiteTheme): Record<string, string> {
  return {
    "--s-bg": theme.bg,
    "--s-surface": theme.surface,
    "--s-surface-strong": theme.surfaceStrong,
    "--s-border": theme.border,
    "--s-text": theme.text,
    "--s-muted": theme.muted,
    "--s-primary": theme.primary,
    "--s-accent": theme.accent,
    "--s-on-primary": theme.onPrimary,
    backgroundColor: theme.bg,
    color: theme.text,
  };
}

function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
}

const SOCIAL_LABELS: [RegExp, string][] = [
  [/instagram\.com/i, "Instagram"],
  [/facebook\.com|fb\.com/i, "Facebook"],
  [/tiktok\.com/i, "TikTok"],
  [/youtube\.com|youtu\.be/i, "YouTube"],
  [/linkedin\.com/i, "LinkedIn"],
  [/x\.com|twitter\.com/i, "X"],
];

function safeSocialLinks(candidates: string[]): { href: string; label: string }[] {
  const seen = new Set<string>();
  const links: { href: string; label: string }[] = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const href = url.href;
      if (seen.has(href)) continue;
      seen.add(href);
      const label = SOCIAL_LABELS.find(([pattern]) => pattern.test(url.hostname))?.[1] ?? url.hostname.replace(/^www\./, "");
      links.push({ href, label });
    } catch {
      // ignore malformed entries
    }
  }
  return links.slice(0, 6);
}

function osmLinks(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) return null;
  const delta = 0.006;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta]
    .map((value) => value.toFixed(6))
    .join("%2C");
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude.toFixed(6)}%2C${longitude.toFixed(6)}`,
    external: `https://www.openstreetmap.org/?mlat=${latitude.toFixed(6)}&mlon=${longitude.toFixed(6)}#map=17/${latitude.toFixed(6)}/${longitude.toFixed(6)}`,
  };
}

const MENU_LABELS: Record<SectorFamily, string> = {
  food: "Cardápio",
  beauty: "Serviços",
  health: "Atendimentos",
  fitness: "Modalidades",
  pet: "Serviços",
  auto: "Serviços",
  education: "Cursos",
  hospitality: "Acomodações",
  professional: "Áreas de atuação",
  retail: "Produtos",
  home: "Serviços",
  default: "Serviços",
};

/** Loads and validates the site for a slug. Cached per request. */
export const loadSite = cache(async (slug: string): Promise<SiteAvailability> => {
  const landing = await getRecord(slug);
  if (!landing) return { ok: false, reason: "missing" };
  const expired = landing.status === "EXPIRED" || isDemoLandingExpired(landing.expiresAt);
  if (expired) {
    if (landing.status !== "EXPIRED") {
      await prisma.demoLanding.update({ where: { id: landing.id }, data: { status: "EXPIRED" } });
    }
    return { ok: false, reason: "expired" };
  }
  if (landing.status !== "APPROVED" || hasOwnWebsite(landing.business.website)) {
    return { ok: false, reason: "unavailable" };
  }

  let content: DemoLandingContent;
  try {
    const snapshotted = await captureLegacyDemoBusinessSnapshot(landing, landing.business);
    content = parseDemoLandingContent(snapshotted.contentJson);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const business = content.businessSnapshot;
  if (!business) return { ok: false, reason: "unavailable" };

  const family = sectorFamily(business.category);
  const base = `/demo/${landing.slug}`;
  const whatsapp = isValidPhoneE164(content.whatsappE164)
    ? {
        href: buildWhatsAppLink(content.whatsappE164, `Olá! Vi o site de ${business.name} e quero falar com vocês.`),
        display: formatPhone(content.whatsappE164),
      }
    : null;
  const phone = isValidPhoneE164(business.phoneE164)
    ? { href: `tel:${business.phoneE164}`, display: formatPhone(business.phoneE164) }
    : null;
  const ctaLabel = normalizeDemoCtaLabel(content.ctaLabel);
  const cta = whatsapp
    ? { href: whatsapp.href, label: ctaLabel, external: true }
    : phone
      ? { href: phone.href, label: "Ligar agora", external: false }
      : { href: `${base}/contato`, label: "Ver contato", external: false };

  const address = [business.address, business.neighborhood, business.city, business.state, business.postalCode]
    .filter(Boolean)
    .join(", ") || null;
  const locationShort = [business.neighborhood, business.city].filter(Boolean).join(", ") || business.city || null;
  const menuLabel = MENU_LABELS[family];
  const nav = [
    { href: base, label: "Início" },
    ...(content.menu.length ? [{ href: `${base}/servicos`, label: menuLabel }] : []),
    { href: `${base}/sobre`, label: "Sobre" },
    { href: `${base}/contato`, label: "Contato" },
  ];

  return {
    ok: true,
    site: {
      slug: landing.slug,
      content,
      business,
      family,
      expiresAt: landing.expiresAt,
      isPermanent: landing.expiresAt.getTime() - Date.now() > 365 * 86_400_000,
      theme: buildTheme(content),
      base,
      nav,
      whatsapp,
      phone,
      cta,
      address,
      locationShort,
      map: osmLinks(business.latitude, business.longitude),
      socialLinks: safeSocialLinks(business.socialLinks),
      heroImage: content.heroImageUrl && isSafeDemoImageUrl(content.heroImageUrl) ? content.heroImageUrl : null,
      menuLabel,
    },
  };
});

export function safeImage(url: string | null | undefined): string | null {
  return url && isSafeDemoImageUrl(url) ? url : null;
}

/** A WhatsApp link that names the item the visitor is asking about. */
export function itemWhatsAppLink(site: SiteView, itemName: string): string | null {
  if (!site.content.whatsappE164 || !isValidPhoneE164(site.content.whatsappE164)) return null;
  return buildWhatsAppLink(
    site.content.whatsappE164,
    `Olá! Vi "${itemName}" no site de ${site.business.name} e quero saber mais.`,
  );
}

export function formatValidUntil(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
