/* eslint-disable @next/next/no-img-element -- demo images come from user-provided, runtime URLs */
import type { CSSProperties } from "react";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Building2,
  Check,
  ChevronRight,
  Coffee,
  Dumbbell,
  ExternalLink,
  HeartPulse,
  Info,
  MapPin,
  MessageCircle,
  Palette,
  PawPrint,
  Phone,
  Scissors,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { prisma } from "@/lib/db";
import { isDemoLandingExpired } from "@/lib/demo-landing";
import { captureLegacyDemoBusinessSnapshot } from "@/lib/demo-landing-store";
import {
  isSafeDemoImageUrl,
  normalizeDemoCtaLabel,
  parseDemoLandingContent,
} from "@/lib/demo-landing-schema";
import {
  findInstagramProfile,
  instagramEmbedUrl,
  instagramPermalink,
  parseInstagramPostUrl,
} from "@/lib/instagram";
import { isValidPhoneE164 } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { classifyWebsite, hasOwnWebsite } from "@/lib/website";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

type CategoryVisual = {
  icon: LucideIcon;
  eyebrow: string;
  detail: string;
};

type SafeSocialLink = {
  href: string;
  label: string;
};

const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "fb.me": "Facebook",
  "messenger.com": "Messenger",
  "whatsapp.com": "WhatsApp",
  "wa.me": "WhatsApp",
  "tiktok.com": "TikTok",
  "linkedin.com": "LinkedIn",
  "twitter.com": "X / Twitter",
  "x.com": "X",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "threads.net": "Threads",
  "pinterest.com": "Pinterest",
  "pin.it": "Pinterest",
  "snapchat.com": "Snapchat",
  "t.me": "Telegram",
  "telegram.me": "Telegram",
  "discord.com": "Discord",
  "discord.gg": "Discord",
  "kwai.com": "Kwai",
  "twitch.tv": "Twitch",
  "vimeo.com": "Vimeo",
  "reddit.com": "Reddit",
  "tumblr.com": "Tumblr",
  "medium.com": "Medium",
  "substack.com": "Substack",
  "behance.net": "Behance",
  "dribbble.com": "Dribbble",
  "github.com": "GitHub",
  "soundcloud.com": "SoundCloud",
  "spotify.com": "Spotify",
  "bsky.app": "Bluesky",
  "bluesky.app": "Bluesky",
  "vk.com": "VK",
};

function safeDemoImageUrl(value: string | null | undefined): string | null {
  if (!value || !isSafeDemoImageUrl(value)) return null;

  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function parseSafeSocialLinks(candidates: string[]): SafeSocialLink[] {
  const links = candidates.flatMap((candidate): SafeSocialLink[] => {
    const classification = classifyWebsite(candidate);
    if (classification.kind !== "social" || !classification.normalizedUrl) return [];

    try {
      const url = new URL(classification.normalizedUrl);
      if (url.protocol !== "https:" || url.username || url.password) return [];

      const platform = classification.platform ?? classification.hostname ?? "";
      return [{ href: url.href, label: SOCIAL_PLATFORM_LABELS[platform] ?? "Rede social" }];
    } catch {
      return [];
    }
  });

  return Array.from(new Map(links.map((link) => [link.href, link])).values()).slice(0, 8);
}

function categoryVisualFor(category: string): CategoryVisual {
  const normalized = category.toLocaleLowerCase("pt-BR");

  if (/sal[aã]o|beleza|barbear|est[eé]tica|cabelo/.test(normalized)) {
    return { icon: Scissors, eyebrow: "Estilo em primeiro plano", detail: "Cuidado e identidade" };
  }
  if (/caf[eé]/.test(normalized)) {
    return { icon: Coffee, eyebrow: "Experiência em foco", detail: "Sabor e encontro" };
  }
  if (/restaurante|comida|lanch|pizz|\bbar\b|padaria|confeitaria/.test(normalized)) {
    return { icon: UtensilsCrossed, eyebrow: "Sabores em evidência", detail: "Identidade e presença" };
  }
  if (/hotel|pousada|hosped|hostel/.test(normalized)) {
    return { icon: BedDouble, eyebrow: "Hospitalidade em foco", detail: "Conforto e descoberta" };
  }
  if (/cl[ií]nica|m[eé]dic|sa[uú]de|dent|odonto|fisi/.test(normalized)) {
    return { icon: HeartPulse, eyebrow: "Informação com cuidado", detail: "Clareza e confiança" };
  }
  if (/academia|fitness|crossfit|pilates|esporte/.test(normalized)) {
    return { icon: Dumbbell, eyebrow: "Movimento em destaque", detail: "Energia e presença" };
  }
  if (/pet|veterin|animal/.test(normalized)) {
    return { icon: PawPrint, eyebrow: "Cuidado em evidência", detail: "Proximidade e atenção" };
  }
  if (/loja|varejo|moda|boutique|mercado|com[eé]rcio/.test(normalized)) {
    return { icon: ShoppingBag, eyebrow: "Marca em destaque", detail: "Produtos e descoberta" };
  }
  return { icon: Building2, eyebrow: "Presença em destaque", detail: "Informação e descoberta" };
}

function buildOsmLinks(latitude: number | null, longitude: number | null) {
  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const latitudeDelta = 0.006;
  const longitudeDelta = 0.009;
  const params = new URLSearchParams({
    bbox: [
      longitude - longitudeDelta,
      latitude - latitudeDelta,
      longitude + longitudeDelta,
      latitude + latitudeDelta,
    ].join(","),
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  });

  return {
    embed: `https://www.openstreetmap.org/export/embed.html?${params.toString()}`,
    external: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=17/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`,
  };
}

/** A preview kept for more than a year is, for the visitor, the site itself. */
function isPermanentPreview(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() > 365 * 86_400_000;
}

function formatSafePhone(value: string): string {
  return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
}

function relativeLuminance(hex: string): number {
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

function mixHex(base: string, tint: string, ratio: number): string {
  const channel = (hex: string, offset: number) =>
    Number.parseInt(hex.slice(offset + 1, offset + 3), 16);
  const parts = [0, 2, 4].map((offset) => {
    const value = Math.round(
      channel(base, offset) * (1 - ratio) + channel(tint, offset) * ratio,
    );
    return Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0");
  });
  return `#${parts.join("")}`;
}

function readableAccentColor(color: string): string {
  return contrastRatio(color, "#07070a") >= 4.5 ? color : "#f8fafc";
}

const getDemo = cache(async (slug: string) =>
  prisma.demoLanding.findUnique({
    where: { slug },
    include: { business: true },
  }),
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await getDemo(slug);
  if (
    !landing ||
    landing.status !== "APPROVED" ||
    isDemoLandingExpired(landing.expiresAt)
  ) {
    return {
      title: "Demonstração indisponível",
      description: "Esta demonstração não está disponível publicamente.",
      robots: { index: false, follow: false, nocache: true },
    };
  }
  let businessName = landing?.business.name;
  if (landing) {
    try {
      businessName = parseDemoLandingContent(landing.contentJson).businessSnapshot?.name ?? businessName;
    } catch {
      // The page itself will render the safe unavailable state for malformed content.
    }
  }
  const title = businessName ? `Demonstração — ${businessName}` : "Demonstração indisponível";

  return {
    title,
    description: "Demonstração não oficial de uma página criada pela NOX OS.",
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
  };
}

function UnavailableDemo({ expired = false }: { expired?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07070b] px-6 text-[#f8fafc]">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/40 sm:p-12">
        <div className="mx-auto mb-6 w-fit rounded-full border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
          Demonstração não oficial
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {expired ? "Esta demonstração expirou" : "Demonstração indisponível"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-400 sm:text-base">
          Este endereço era uma prévia temporária e não representa um site oficial do estabelecimento.
        </p>
        <p className="mt-8 text-xs uppercase tracking-[0.16em] text-slate-400">Criado com NOX OS</p>
      </section>
    </main>
  );
}

export default async function DemoLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await getDemo(slug);
  if (!landing) notFound();

  const expired = landing.status === "EXPIRED" || isDemoLandingExpired(landing.expiresAt);
  if (expired) {
    if (landing.status !== "EXPIRED") {
      await prisma.demoLanding.update({
        where: { id: landing.id },
        data: { status: "EXPIRED" },
      });
    }
    return <UnavailableDemo expired />;
  }

  if (landing.status !== "APPROVED") {
    return <UnavailableDemo />;
  }

  if (hasOwnWebsite(landing.business.website)) {
    return <UnavailableDemo />;
  }

  let content;
  try {
    const snapshottedLanding = await captureLegacyDemoBusinessSnapshot(
      landing,
      landing.business,
    );
    content = parseDemoLandingContent(snapshottedLanding.contentJson);
  } catch {
    return <UnavailableDemo />;
  }

  const business = content.businessSnapshot;
  if (!business) return <UnavailableDemo />;
  const location = [business.city, business.state].filter(Boolean).join(" — ");
  const locationSummary = [business.neighborhood, location].filter(Boolean).join(", ");
  const fullAddress = [
    business.address,
    business.neighborhood,
    business.city,
    business.state,
    business.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const hasLocationDetails = Boolean(
    locationSummary || business.address || business.postalCode,
  );
  const locationHeadline = locationSummary || business.address || business.name;
  const businessInitial = business.name.trim().charAt(0).toUpperCase() || "N";
  const categoryVisual = categoryVisualFor(business.category);
  const CategoryIcon = categoryVisual.icon;
  const accentTextColor = readableAccentColor(content.accentColor);
  const ctaLabel = normalizeDemoCtaLabel(content.ctaLabel);
  const safePhone = isValidPhoneE164(business.phoneE164)
    ? {
        href: `tel:${business.phoneE164}`,
        display: formatSafePhone(business.phoneE164),
      }
    : null;
  const socialLinks = parseSafeSocialLinks(business.socialLinks);
  const osmLinks = buildOsmLinks(business.latitude, business.longitude);
  const heroImageUrl = safeDemoImageUrl(content.heroImageUrl);
  const galleryImages = content.galleryImages.flatMap((image) => {
    const url = safeDemoImageUrl(image.url);
    return url ? [{ ...image, url }] : [];
  });
  // Rebuilt from the parsed shortcode, never from the stored string.
  const instagramEmbeds = content.instagramPosts.flatMap((postUrl) => {
    const ref = parseInstagramPostUrl(postUrl);
    return ref
      ? [{ src: instagramEmbedUrl(ref), permalink: instagramPermalink(ref), key: ref.shortcode }]
      : [];
  });
  const instagramProfile = findInstagramProfile(business.socialLinks);
  const heroImageIsStock = Boolean(heroImageUrl) && content.heroImageKind === "stock";
  const hasIllustrativePhotos =
    heroImageIsStock || galleryImages.some((image) => image.kind === "stock");
  // One credit line per photographer, as the provider licence requires.
  const photoCredits = Array.from(
    new Set(
      [
        heroImageIsStock ? content.heroImageCredit : null,
        ...galleryImages.map((image) => (image.kind === "stock" ? image.credit : null)),
      ].filter((credit): credit is string => Boolean(credit)),
    ),
  ).slice(0, 8);
  const whatsapp = isValidPhoneE164(content.whatsappE164)
    ? {
        href: buildWhatsAppLink(
          content.whatsappE164,
          `Olá! Vi a página de ${business.name} e quero falar com vocês.`,
        ),
        display: formatSafePhone(content.whatsappE164),
      }
    : null;
  const mainCtaHref = whatsapp ? whatsapp.href : safePhone && ctaLabel === "Ligar agora" ? safePhone.href : "#contato";
  const mainCtaLabel = ctaLabel;
  const mainCtaExternal = Boolean(whatsapp);
  const validUntil = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(landing.expiresAt);
  const isPermanent = isPermanentPreview(landing.expiresAt);
  const accessibleGradient = `linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58)), linear-gradient(135deg, ${content.primaryColor}, ${content.accentColor})`;
  // The page ground carries a trace of the business's own colour, so a demo for a
  // bakery does not sit on the same neutral black as one for a garage.
  const ink = mixHex("#07070a", content.primaryColor, 0.07);
  const theme = {
    "--demo-primary": content.primaryColor,
    "--demo-accent": content.accentColor,
    backgroundColor: ink,
  } as CSSProperties;

  return (
    <main
      className="demo-page min-h-screen overflow-x-clip pb-24 text-slate-50 selection:bg-white/20 md:pb-0"
      style={theme}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage: `radial-gradient(circle at 8% 5%, ${content.primaryColor}35, transparent 29rem), radial-gradient(circle at 92% 22%, ${content.accentColor}24, transparent 27rem), radial-gradient(circle at 50% 100%, ${content.primaryColor}1f, transparent 34rem)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.9) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <div className="sticky top-0 z-[60] flex h-9 items-center justify-center border-b border-amber-200/15 bg-[#17130d]/95 px-3 text-center text-[9px] font-semibold uppercase tracking-[0.13em] text-amber-100 backdrop-blur-2xl sm:text-[10px] sm:tracking-[0.17em]">
        <span className="inline-flex min-w-0 items-center justify-center gap-2">
          <Info aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="truncate">{isPermanent ? `Site de ${business.name}` : `Prévia temporária · válida até ${validUntil}`}</span>
        </span>
      </div>

      <div className="relative z-10">
        <nav
          className="sticky top-9 z-40 border-b border-white/[0.07] backdrop-blur-2xl"
          style={{ backgroundColor: `${ink}e0` }}
        >
          <div className="mx-auto flex h-[4.75rem] max-w-[70rem] items-center justify-between gap-5 px-5 sm:px-8 lg:px-10">
            <a href="#inicio" className="flex min-w-0 items-center gap-3" aria-label="Voltar ao início">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-lg"
                style={{
                  backgroundImage: accessibleGradient,
                  boxShadow: `0 12px 34px ${content.primaryColor}30`,
                }}
              >
                {businessInitial}
              </span>
              <span className="truncate text-sm font-semibold tracking-tight text-white sm:text-base">
                {business.name}
              </span>
            </a>

            <div className="hidden items-center gap-6 text-[13px] font-medium text-slate-400 lg:flex">
              <a className="transition hover:text-white" href="#sobre">
                Sobre
              </a>
              <a className="transition hover:text-white" href="#galeria">
                Galeria
              </a>
              {instagramEmbeds.length ? (
                <a className="transition hover:text-white" href="#instagram">
                  Instagram
                </a>
              ) : null}
              {content.services.length ? (
                <a className="transition hover:text-white" href="#servicos">
                  Serviços
                </a>
              ) : null}
              {content.benefits.length ? (
                <a className="transition hover:text-white" href="#diferenciais">
                  Diferenciais
                </a>
              ) : null}
              <a className="transition hover:text-white" href="#processo">
                Como funciona
              </a>
              <a className="transition hover:text-white" href="#contato">
                Contato
              </a>
              {content.faqs.length ? (
                <a className="transition hover:text-white" href="#duvidas">
                  Dúvidas
                </a>
              ) : null}
            </div>

            <a
              href={mainCtaHref}
              target={mainCtaExternal ? "_blank" : undefined}
              rel={mainCtaExternal ? "noopener noreferrer" : undefined}
              className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.11] sm:px-5 sm:text-sm"
            >
              {mainCtaLabel}
              <ArrowDownRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5"
              />
            </a>
          </div>
        </nav>

        <section id="inicio" className="relative scroll-mt-24">
          {heroImageUrl ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
              <img
                src={heroImageUrl}
                alt=""
                className="h-full w-full scale-105 object-cover opacity-25"
                decoding="async"
                loading="eager"
                referrerPolicy="no-referrer"
              />
              {/* Heavy scrim: the headline must keep its contrast over any photo. */}
              <div className="absolute inset-0" style={{ backgroundColor: `${ink}cc` }} />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `linear-gradient(to bottom, ${ink}, ${ink}8c, ${ink})`,
                }}
              />
            </div>
          ) : null}

          <div className="relative mx-auto grid min-h-[calc(100vh-7.5rem)] max-w-[70rem] items-center gap-14 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-24">
          <div className="min-w-0 max-w-3xl">
            <div
              className="mb-7 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.17em]"
              style={{
                borderColor: `${content.accentColor}55`,
                backgroundColor: `${content.accentColor}18`,
                color: accentTextColor,
              }}
            >
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              {business.category}{locationSummary ? ` · ${locationSummary}` : ""}
            </div>
            <h1 className="text-[clamp(3.4rem,7.4vw,6.8rem)] leading-[0.94] text-white">
              {content.headline}
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg sm:leading-9">
              {content.subheadline}
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={mainCtaHref}
                target={mainCtaExternal ? "_blank" : undefined}
                rel={mainCtaExternal ? "noopener noreferrer" : undefined}
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)] transition hover:-translate-y-0.5"
                style={{
                  backgroundImage: accessibleGradient,
                  boxShadow: `0 20px 55px ${content.primaryColor}30`,
                }}
              >
                {mainCtaLabel}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                />
              </a>
              <a
                href="#sobre"
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                Conheça {business.name}
              </a>
            </div>

            <div className="mt-9 grid gap-3 text-xs font-medium text-slate-400 sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
              {whatsapp ? (
                <span className="inline-flex items-center gap-2">
                  <BadgeCheck aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  Atendimento pelo WhatsApp
                </span>
              ) : null}
              {locationSummary ? (
                <span className="inline-flex items-center gap-2">
                  <MapPin aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  {locationSummary}
                </span>
              ) : null}
              {!whatsapp && !locationSummary ? (
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  Informações confirmadas
                </span>
              ) : null}
            </div>
          </div>

          <aside className="relative mx-auto min-w-0 w-full max-w-xl lg:ml-auto">
            <div
              aria-hidden="true"
              className="absolute -inset-8 -z-10 rounded-full opacity-25 blur-3xl"
              style={{ backgroundColor: content.primaryColor }}
            />
            <div className="relative min-w-0 overflow-hidden rounded-[2rem] border border-white/10 bg-[#101016] shadow-2xl shadow-black/50 sm:rounded-[2.5rem]">
              {heroImageUrl ? (
                <div className="relative min-h-[31rem] min-w-0 w-full sm:aspect-[4/5]">
                  <img
                    src={heroImageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    decoding="async"
                    loading="eager"
                    referrerPolicy="no-referrer"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/90"
                  />
                  <span className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-xl">
                    {heroImageIsStock ? "Imagem ilustrativa" : "Imagem fornecida"}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                      {business.category}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                      {business.name}
                    </h2>
                    {locationSummary ? (
                      <p className="mt-3 flex items-center gap-2 text-sm text-white/70">
                        <MapPin aria-hidden="true" className="h-4 w-4" />
                        {locationSummary}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div
                  className="relative min-h-[31rem] min-w-0 w-full overflow-hidden p-6 sm:aspect-[4/5] sm:p-8"
                  role="img"
                  aria-label={`Composição visual ilustrativa para a categoria ${business.category}`}
                  style={{
                    backgroundImage: `radial-gradient(circle at 82% 14%, ${content.accentColor}46, transparent 14rem), radial-gradient(circle at 18% 88%, ${content.primaryColor}4f, transparent 18rem), linear-gradient(145deg, #15151d, #09090d)`,
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="absolute -right-24 top-20 h-72 w-72 rounded-full border border-white/10"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute -right-10 top-36 h-44 w-44 rounded-full border border-white/10"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute -left-20 bottom-16 h-64 w-64 rotate-12 rounded-[4rem] border border-white/[0.08]"
                  />
                  <div className="relative flex h-full min-h-[27rem] flex-col justify-between">
                    <div className="flex items-start justify-between gap-5">
                      <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/75 backdrop-blur-xl">
                        Imagem ilustrativa
                      </span>
                      <span
                        className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-white/10 shadow-2xl"
                        style={{ backgroundImage: accessibleGradient }}
                      >
                        <CategoryIcon aria-hidden="true" className="h-7 w-7 text-white" />
                      </span>
                    </div>

                    <div className="relative">
                      <p
                        className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                        style={{ color: accentTextColor }}
                      >
                        {categoryVisual.eyebrow}
                      </p>
                      <p className="mt-5 text-[clamp(3.5rem,11vw,6rem)] font-semibold leading-[0.82] tracking-[-0.075em] text-white/95">
                        {businessInitial}
                      </p>
                      <div className="mt-7 grid grid-cols-[1fr_auto] items-end gap-4 border-t border-white/10 pt-5">
                        <div>
                          <h2 className="text-2xl font-semibold tracking-[-0.035em] text-white">
                            {business.name}
                          </h2>
                          <p className="mt-2 text-sm text-slate-400">{categoryVisual.detail}</p>
                        </div>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Conceito visual
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="relative z-10 mx-4 -mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-[#111118]/95 shadow-xl shadow-black/40 backdrop-blur-2xl sm:mx-7">
              <div className="border-r border-white/[0.07] p-4 sm:p-5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Categoria
                </p>
                <p className="mt-2 truncate text-sm font-medium text-slate-200">{business.category}</p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Localização
                </p>
                <p className="mt-2 truncate text-sm font-medium text-slate-200">
                  {locationSummary || "Consulte os dados"}
                </p>
              </div>
            </div>
          </aside>
          </div>
        </section>

        <section
          id="sobre"
          className="mx-auto grid max-w-[70rem] scroll-mt-28 gap-12 border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-28 lg:grid-cols-[0.75fr_1.25fr] lg:px-10 lg:py-36"
        >
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: accentTextColor }}
            >
              Sobre o negócio
            </p>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl">
              {content.aboutTitle}
            </h2>
          </div>
          <div className="relative border-l border-white/10 pl-7 sm:pl-10 lg:pl-14">
            <span
              aria-hidden="true"
              className="absolute -left-1 top-1 h-2 w-2 rounded-full"
              style={{ backgroundColor: content.accentColor, boxShadow: `0 0 20px ${content.accentColor}` }}
            />
            <p className="max-w-3xl text-lg leading-9 text-slate-300 sm:text-xl sm:leading-10">
              {content.about}
            </p>
            <div className="mt-9 flex items-center gap-3 text-sm text-slate-400">
              <span className="h-px w-10 bg-white/15" />
              {business.category}{location ? ` em ${location}` : ""}
            </div>
          </div>
        </section>

        <section
          id="galeria"
          className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
        >
          <div className="mx-auto max-w-[70rem] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: accentTextColor }}
                >
                  Visão geral
                </p>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  {content.galleryTitle}
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-slate-400 lg:justify-self-end lg:text-lg">
                {content.galleryIntro}
              </p>
            </div>

            {galleryImages.length ? (
              <div
                className={`mt-12 grid auto-rows-[16rem] gap-4 md:auto-rows-[19rem] ${
                  galleryImages.length === 1
                    ? "grid-cols-1"
                    : galleryImages.length === 2
                      ? "md:grid-cols-2"
                      : "md:grid-cols-2 lg:grid-cols-3"
                }`}
              >
                {galleryImages.map((image, index) => (
                  <figure
                    key={`${index}-${image.url}`}
                    className={`group relative overflow-hidden rounded-[1.75rem] border border-white/[0.09] bg-[#101016] ${
                      galleryImages.length >= 3 && index === 0
                        ? "md:row-span-2 lg:col-span-2"
                        : ""
                    }`}
                  >
                    <img
                      src={image.url}
                      alt=""
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.025]"
                      decoding="async"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10"
                    />
                    <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
                      <span className="max-w-md text-sm font-medium leading-6 text-white/90">
                        {image.alt}
                      </span>
                      <span className="shrink-0 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[0.15em] text-white/70 backdrop-blur-xl">
                        {image.kind === "stock" ? "Imagem ilustrativa" : "Imagem fornecida"}
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="mt-12 grid gap-4 md:grid-cols-3">
                {[
                  {
                    icon: CategoryIcon,
                    eyebrow: categoryVisual.eyebrow,
                    title: business.category,
                    detail: "Direção visual conceitual",
                  },
                  {
                    icon: Palette,
                    eyebrow: "Identidade digital",
                    title: business.name,
                    detail: "Marca em primeiro plano",
                  },
                  {
                    icon: MessageCircle,
                    eyebrow: "Informação acessível",
                    title: locationSummary || "Presença local",
                    detail: "Conteúdo organizado",
                  },
                ].map(({ icon: VisualIcon, eyebrow, title, detail }, index) => (
                  <figure
                    key={`${index}-${title}`}
                    className={`group relative min-h-[25rem] overflow-hidden rounded-[1.75rem] border border-white/[0.09] p-6 ${
                      index === 1 ? "md:-translate-y-5" : ""
                    }`}
                    role="img"
                    aria-label={`Imagem ilustrativa: ${eyebrow}`}
                    style={{
                      backgroundImage:
                        index === 0
                          ? `radial-gradient(circle at 80% 18%, ${content.primaryColor}55, transparent 12rem), linear-gradient(150deg, #15151d, #09090d)`
                          : index === 1
                            ? `radial-gradient(circle at 18% 82%, ${content.accentColor}42, transparent 13rem), linear-gradient(25deg, #0b0b10, #191922)`
                            : `linear-gradient(135deg, ${content.primaryColor}25, transparent 48%), radial-gradient(circle at 72% 72%, ${content.accentColor}35, transparent 12rem), #0d0d13`,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      className={`absolute border border-white/[0.09] ${
                        index === 0
                          ? "-right-16 top-20 h-64 w-64 rotate-12 rounded-[4rem]"
                          : index === 1
                            ? "-left-20 bottom-12 h-72 w-72 rounded-full"
                            : "right-8 top-24 h-48 w-32 -rotate-12 rounded-full"
                      }`}
                    />
                    <div className="relative flex h-full min-h-[22rem] flex-col justify-between">
                      <div className="flex items-start justify-between gap-4">
                        <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[0.15em] text-white/70 backdrop-blur-xl">
                          Imagem ilustrativa
                        </span>
                        <span
                          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10"
                          style={{ backgroundColor: `${content.accentColor}18`, color: accentTextColor }}
                        >
                          <VisualIcon aria-hidden="true" className="h-5 w-5" />
                        </span>
                      </div>
                      <figcaption>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {eyebrow}
                        </p>
                        <p className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.035em] text-white">
                          {title}
                        </p>
                        <p className="mt-3 text-sm text-slate-400">{detail}</p>
                      </figcaption>
                    </div>
                  </figure>
                ))}
              </div>
            )}

            {!galleryImages.length ? (
              <p className="mt-6 text-center text-xs leading-6 text-slate-400">
                As composições acima são apenas ilustrativas e não representam fotos reais do estabelecimento,
                de produtos ou de serviços.
              </p>
            ) : galleryImages.some((image) => image.kind === "stock") ? (
              <p className="mt-6 text-center text-xs leading-6 text-slate-400">
                As imagens marcadas como ilustrativas são fotos de banco licenciadas e não retratam o
                estabelecimento, seus produtos ou seus serviços.
              </p>
            ) : null}
          </div>
        </section>

        {instagramEmbeds.length ? (
          <section id="instagram" className="scroll-mt-28 py-24 sm:py-28">
            <div className="mx-auto max-w-[70rem] px-5 sm:px-8 lg:px-10">
              <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
                <div>
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.2em]"
                    style={{ color: accentTextColor }}
                  >
                    Conteúdo do estabelecimento
                  </p>
                  <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                    {content.instagramTitle}
                  </h2>
                </div>
                <p className="max-w-2xl text-base leading-8 text-slate-400 lg:justify-self-end lg:text-lg">
                  {content.instagramIntro}
                </p>
              </div>

              <div
                className={`mt-12 grid gap-5 ${
                  instagramEmbeds.length === 1
                    ? "max-w-xl"
                    : instagramEmbeds.length === 2
                      ? "md:grid-cols-2"
                      : "md:grid-cols-2 lg:grid-cols-3"
                }`}
              >
                {instagramEmbeds.map((embed) => (
                  <div
                    key={embed.key}
                    className="overflow-hidden rounded-[1.75rem] border border-white/[0.09] bg-white"
                  >
                    <iframe
                      src={embed.src}
                      title="Publicação do Instagram do estabelecimento"
                      loading="lazy"
                      scrolling="no"
                      allowFullScreen
                      className="h-[34rem] w-full border-0"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-xs leading-6 text-slate-400">
                <span>
                  Publicações exibidas pelo próprio Instagram. O conteúdo pertence ao
                  estabelecimento.
                </span>
                {instagramProfile ? (
                  <a
                    href={instagramProfile.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-slate-300 underline decoration-white/25 underline-offset-4 transition hover:text-white"
                  >
                    @{instagramProfile.username}
                    <ExternalLink aria-hidden="true" className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {content.services.length ? (
          <section
            id="servicos"
            className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
          >
            <div className="mx-auto max-w-[70rem] px-5 sm:px-8 lg:px-10">
              <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
                <div>
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.2em]"
                    style={{ color: accentTextColor }}
                  >
                    Serviços informados
                  </p>
                  <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
                    {content.servicesTitle}
                  </h2>
                </div>
                <p className="max-w-2xl text-base leading-8 text-slate-400 lg:justify-self-end lg:text-lg">
                  {content.servicesIntro}
                </p>
              </div>

              <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {content.services.map((service, index) => (
                  <article
                    key={`${index}-${service}`}
                    className="group relative overflow-hidden rounded-[1.6rem] border border-white/[0.08] bg-[#0d0d12] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/15 sm:p-7"
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-px opacity-70"
                      style={{ backgroundImage: `linear-gradient(90deg, transparent, ${content.accentColor}, transparent)` }}
                    />
                    <div className="flex items-start justify-between gap-5">
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-2xl text-xs font-bold"
                        style={{ backgroundColor: `${content.primaryColor}1f`, color: accentTextColor }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <ArrowDownRight
                        aria-hidden="true"
                        className="h-5 w-5 text-slate-400 transition group-hover:text-white"
                      />
                    </div>
                    <h3 className="mt-9 text-lg font-semibold leading-7 text-slate-100">{service}</h3>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {content.benefits.length ? (
          <section
            id="diferenciais"
            className="mx-auto max-w-[70rem] scroll-mt-28 px-5 py-24 sm:px-8 sm:py-28 lg:px-10 lg:py-36"
          >
            <div className="max-w-3xl">
              <p
                className="text-xs font-semibold uppercase tracking-[0.2em]"
                style={{ color: accentTextColor }}
              >
                Informações disponíveis
              </p>
              <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
                {content.factsTitle}
              </h2>
            </div>

            <div className="mt-12 grid overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] md:grid-cols-2 lg:grid-cols-3">
              {content.benefits.map((benefit, index) => (
                <article
                  key={`${index}-${benefit}`}
                  className="relative min-h-52 border-b border-white/[0.07] p-7 last:border-b-0 md:border-r md:[&:nth-child(even)]:border-r-0 lg:[&:nth-child(even)]:border-r lg:[&:nth-child(3n)]:border-r-0 sm:p-8"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${content.accentColor}18`, color: accentTextColor }}
                    >
                      <Check aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-slate-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-9 max-w-sm text-base leading-8 text-slate-300">{benefit}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section
          id="processo"
          className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
        >
          <div className="mx-auto max-w-[70rem] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: accentTextColor }}
                >
                  Uma experiência simples
                </p>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
                  {content.processTitle}
                </h2>
                <p className="mt-6 max-w-xl text-base leading-8 text-slate-400">
                  {content.processIntro}
                </p>
              </div>

              <ol className="relative grid gap-4">
                {content.processSteps.map((step, index) => (
                  <li
                    key={`${index}-${step}`}
                    className="group flex gap-5 rounded-[1.6rem] border border-white/[0.08] bg-[#0d0d12] p-5 transition hover:border-white/15 sm:gap-7 sm:p-7"
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xs font-bold"
                      style={{
                        backgroundImage: `linear-gradient(145deg, ${content.primaryColor}2c, ${content.accentColor}16)`,
                        color: accentTextColor,
                      }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex flex-1 items-center justify-between gap-5">
                      <p className="text-base leading-7 text-slate-200 sm:text-lg">{step}</p>
                      <ChevronRight
                        aria-hidden="true"
                        className="hidden h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-white sm:block"
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section
          id="contato"
          className="scroll-mt-28 border-t border-white/[0.07] bg-white/[0.018] py-24 sm:py-28 lg:py-36"
        >
          <div className="mx-auto max-w-[70rem] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: accentTextColor }}
                >
                  Contato e localização
                </p>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  {content.contactTitle}
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-slate-400 lg:justify-self-end lg:text-lg">
                {content.contactText}
              </p>
            </div>

            <div className="mt-12 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                {whatsapp ? (
                  <a
                    href={whatsapp.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-[1.6rem] border border-emerald-300/25 bg-emerald-400/[0.07] p-5 transition hover:-translate-y-0.5 hover:border-emerald-300/50 sm:gap-5 sm:p-6"
                  >
                    <span className="flex min-w-0 items-center gap-4">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                        <MessageCircle aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[9px] font-semibold uppercase tracking-[0.17em] text-emerald-200/80">
                          WhatsApp
                        </span>
                        <span className="mt-2 block truncate text-base font-semibold text-white">
                          {whatsapp.display}
                        </span>
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-emerald-200 transition group-hover:translate-x-1"
                    />
                  </a>
                ) : null}
                {safePhone && (!whatsapp || safePhone.href !== `tel:${content.whatsappE164}`) ? (
                  <a
                    href={safePhone.href}
                    className="group flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-[1.6rem] border border-white/[0.09] bg-[#101016] p-5 transition hover:-translate-y-0.5 hover:border-white/20 sm:gap-5 sm:p-6"
                  >
                    <span className="flex min-w-0 items-center gap-4">
                      <span
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                        style={{ backgroundColor: `${content.accentColor}18`, color: accentTextColor }}
                      >
                        <Phone aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400">
                          Telefone
                        </span>
                        <span className="mt-2 block truncate text-base font-semibold text-white">
                          {safePhone.display}
                        </span>
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-white"
                    />
                  </a>
                ) : null}

                {hasLocationDetails ? (
                  <div className="flex min-w-0 gap-4 overflow-hidden rounded-[1.6rem] border border-white/[0.09] bg-[#101016] p-5 sm:p-6">
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: `${content.primaryColor}1f`, color: accentTextColor }}
                    >
                      <MapPin aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400">
                        Endereço
                      </p>
                      <p className="mt-2 break-words text-sm leading-7 text-slate-200">{fullAddress}</p>
                    </div>
                  </div>
                ) : null}

                <div className="min-w-0 overflow-hidden rounded-[1.6rem] border border-white/[0.09] bg-[#101016] p-5 sm:p-6">
                  <div className="flex items-center gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-slate-300">
                      <Share2 aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-slate-400">
                        Redes sociais
                      </p>
                      <p className="mt-2 text-sm text-slate-400">
                        {socialLinks.length
                          ? "Acesse os perfis informados para conferir detalhes."
                          : "As redes sociais entram aqui na versão final."}
                      </p>
                    </div>
                  </div>

                  {socialLinks.length ? (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.07] pt-5">
                      {socialLinks.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                          aria-label={`Abrir ${link.label} de ${business.name} em nova aba`}
                        >
                          {link.label}
                          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>

                {!safePhone && !hasLocationDetails && !socialLinks.length ? (
                  <div className="rounded-2xl border border-amber-200/10 bg-amber-100/[0.04] p-5 text-sm leading-7 text-amber-100/65">
                    Nenhum canal de contato seguro está disponível para exibição nesta prévia.
                    Confirme os dados diretamente com o estabelecimento antes de publicar a versão oficial.
                  </div>
                ) : null}
              </div>

              <div
                id="localizacao"
                className="relative min-h-[31rem] min-w-0 scroll-mt-28 overflow-hidden rounded-[2rem] border border-white/[0.09] bg-[#101016]"
              >
                {osmLinks ? (
                  <>
                    <iframe
                      src={osmLinks.embed}
                      title={`Mapa da localização informada de ${business.name}`}
                      className="absolute inset-0 h-full w-full border-0 opacity-90 [filter:grayscale(.7)_contrast(.9)]"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-popups allow-same-origin allow-scripts"
                    />
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/65 to-transparent" />
                    <div className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/80 backdrop-blur-xl">
                      Localização informada
                    </div>
                    <a
                      href={osmLinks.external}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-5 right-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-4 py-2.5 text-xs font-semibold text-white shadow-xl backdrop-blur-xl transition hover:bg-black/85"
                    >
                      Abrir mapa
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-5 left-5 rounded-full border border-white/15 bg-black/70 px-3 py-2 text-[9px] font-medium text-white/70 backdrop-blur-xl transition hover:text-white"
                    >
                      © OpenStreetMap contributors
                    </a>
                  </>
                ) : (
                  <div
                    className="absolute inset-0 p-7 sm:p-10"
                    style={{
                      backgroundImage: `radial-gradient(circle at 70% 30%, ${content.primaryColor}24, transparent 18rem), linear-gradient(135deg, rgba(255,255,255,.025), transparent)`,
                    }}
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 opacity-[0.09]"
                      style={{
                        backgroundImage:
                          "linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px)",
                        backgroundSize: "42px 42px",
                        transform: "perspective(500px) rotateX(55deg) scale(1.45)",
                        transformOrigin: "center bottom",
                      }}
                    />
                    <div className="relative flex h-full min-h-[25rem] flex-col justify-between">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Visual de localização · Imagem ilustrativa
                        </p>
                        <h3 className="mt-5 max-w-lg text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
                          {locationHeadline}
                        </h3>
                      </div>

                      <div className="flex items-end justify-between gap-6">
                        <span
                          className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-2xl"
                          style={{
                            backgroundImage: accessibleGradient,
                            boxShadow: `0 16px 50px ${content.primaryColor}45`,
                          }}
                        >
                          <MapPin aria-hidden="true" className="h-6 w-6" />
                        </span>
                        <span className="max-w-xs text-right text-xs leading-5 text-slate-400">
                          Um mapa real será exibido somente quando houver coordenadas válidas.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.045] p-4 text-xs leading-6 text-emerald-100/65">
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              Contato e endereço confirmados antes da publicação desta página.
            </div>
          </div>
        </section>

        {content.faqs.length ? (
          <section
            id="duvidas"
            className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
          >
            <div className="mx-auto grid max-w-[70rem] gap-12 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:px-10">
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: accentTextColor }}
                >
                  Informações úteis
                </p>
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
                  {content.faqTitle}
                </h2>
              </div>

              <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                {content.faqs.map((faq, index) => (
                  <article key={`${index}-${faq.question}`} className="grid gap-3 py-7 sm:grid-cols-[2.5rem_1fr] sm:gap-5">
                    <span className="pt-1 text-[10px] font-semibold tracking-[0.16em] text-slate-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold leading-7 text-slate-100 sm:text-lg">
                        {faq.question}
                      </h3>
                      <p className="mt-3 text-sm leading-7 text-slate-400 sm:text-base sm:leading-8">
                        {faq.answer}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-[70rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
          <div
            className="relative overflow-hidden rounded-[2rem] border border-white/10 px-7 py-14 text-center sm:rounded-[2.5rem] sm:px-12 sm:py-20"
            style={{
              backgroundImage: `radial-gradient(circle at 15% 10%, ${content.primaryColor}35, transparent 20rem), radial-gradient(circle at 90% 100%, ${content.accentColor}30, transparent 22rem), linear-gradient(145deg, rgba(255,255,255,.065), rgba(255,255,255,.025))`,
            }}
          >
            <div className="relative mx-auto max-w-3xl">
              <span
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${content.accentColor}18`, color: accentTextColor }}
              >
                <Sparkles aria-hidden="true" className="h-5 w-5" />
              </span>
              <h2 className="mt-7 text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
                {content.finalCtaTitle}
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                {content.finalCtaText}
              </p>
              <a
                href={mainCtaHref}
                target={mainCtaExternal ? "_blank" : undefined}
                rel={mainCtaExternal ? "noopener noreferrer" : undefined}
                className="group mt-9 inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)] transition hover:-translate-y-0.5"
                style={{
                  backgroundImage: accessibleGradient,
                  boxShadow: `0 20px 55px ${content.primaryColor}30`,
                }}
              >
                {mainCtaLabel}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                />
              </a>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/[0.07] bg-black/15">
          <div className="mx-auto max-w-[70rem] px-5 py-12 sm:px-8 lg:px-10">
            <div className="grid gap-8 border-b border-white/[0.07] pb-9 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold text-white"
                    style={{ backgroundImage: accessibleGradient }}
                  >
                    {businessInitial}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{business.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{business.category}</p>
                  </div>
                </div>
              </div>
              <nav
                aria-label="Navegação do rodapé"
                className="flex flex-wrap gap-x-5 gap-y-3 text-xs font-medium text-slate-400 md:justify-end"
              >
                <a href="#inicio" className="transition hover:text-white">Início</a>
                <a href="#sobre" className="transition hover:text-white">Sobre</a>
                <a href="#galeria" className="transition hover:text-white">Galeria</a>
                {content.services.length ? (
                  <a href="#servicos" className="transition hover:text-white">Serviços</a>
                ) : null}
                <a href="#contato" className="transition hover:text-white">Contato</a>
              </nav>
            </div>
            <div className="grid gap-5 pt-8 text-center md:grid-cols-[1fr_auto] md:items-center md:text-left">
              <p className="max-w-2xl text-xs leading-6 text-slate-400">
                {isPermanent
                  ? `Página de ${business.name}, criada e mantida pela NOX OS.`
                  : `Prévia temporária preparada pela NOX OS para ${business.name}. Torna-se o site definitivo após a aprovação do estabelecimento.`}
                {hasIllustrativePhotos
                  ? " As fotografias marcadas como ilustrativas são de banco de imagens licenciado e não retratam o estabelecimento."
                  : ""}
              </p>
              <div className="md:text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {isPermanent ? "Site por NOX OS" : "NOX OS · Prévia temporária"}
                </p>
                <p className="mt-2 text-[10px] text-slate-400">Não indexada por mecanismos de busca</p>
              </div>
            </div>

            {photoCredits.length ? (
              <div className="mt-8 border-t border-white/[0.07] pt-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Créditos das imagens ilustrativas
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] leading-5 text-slate-400">
                  {photoCredits.map((credit) => (
                    <li key={credit}>{credit}</li>
                  ))}
                </ul>
                <a
                  href="https://www.pexels.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-slate-300 underline decoration-white/25 underline-offset-4 transition hover:text-white"
                >
                  Fotos via Pexels
                  <ExternalLink aria-hidden="true" className="h-3 w-3" />
                </a>
              </div>
            ) : null}
          </div>
        </footer>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#09090d]/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-16px_45px_rgba(0,0,0,.45)] backdrop-blur-2xl md:hidden">
        <a
          href={whatsapp ? whatsapp.href : (safePhone?.href ?? mainCtaHref)}
          target={whatsapp ? "_blank" : undefined}
          rel={whatsapp ? "noopener noreferrer" : undefined}
          className="flex min-h-13 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white"
          style={{ backgroundImage: accessibleGradient }}
        >
          {whatsapp ? <MessageCircle aria-hidden="true" className="h-4 w-4" /> : safePhone ? <Phone aria-hidden="true" className="h-4 w-4" /> : <Info aria-hidden="true" className="h-4 w-4" />}
          {whatsapp ? mainCtaLabel : safePhone ? `Ligar · ${safePhone.display}` : "Ver contato e localização"}
        </a>
      </div>
    </main>
  );
}
