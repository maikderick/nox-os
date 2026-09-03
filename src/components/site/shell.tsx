/* eslint-disable @next/next/no-img-element -- site images come from validated runtime URLs */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Clock, ExternalLink, MapPin, MessageCircle, Phone } from "lucide-react";

import { formatValidUntil, themeStyle, type SiteView } from "@/lib/site-view";

/* ---------------------------------------------------------------------------
   Shared building blocks of the generated site. Everything reads its colours
   from the CSS variables the layout sets, so a page never hard-codes a colour.
   --------------------------------------------------------------------------- */

export function SiteFrame({ site, children }: { site: SiteView; children: ReactNode }) {
  return (
    <div
      className="demo-page min-h-screen antialiased"
      style={themeStyle(site.theme) as CSSProperties}
      data-theme={site.theme.mode}
    >
      <SiteHeader site={site} />
      <main className="pb-24 md:pb-0">{children}</main>
      <SiteFooter site={site} />
      <MobileBar site={site} />
    </div>
  );
}

export function SiteHeader({ site }: { site: SiteView }) {
  const initial = site.business.name.trim().charAt(0).toUpperCase() || "N";
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-xl"
      style={{ borderColor: "var(--s-border)", backgroundColor: "color-mix(in srgb, var(--s-bg) 88%, transparent)" }}
    >
      <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href={site.base} className="flex min-w-0 items-center gap-3" aria-label={`${site.business.name} — início`}>
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold"
            style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }}
          >
            {initial}
          </span>
          <span className="truncate text-base font-bold tracking-tight sm:text-lg">{site.business.name}</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium md:flex" aria-label="Páginas do site">
          {site.nav.map((item) => (
            <Link key={item.href} href={item.href} className="opacity-80 transition hover:opacity-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <CtaLink site={site} className="hidden md:inline-flex" size="sm" />
        <nav className="flex items-center gap-4 text-sm font-medium md:hidden" aria-label="Páginas do site">
          {site.nav.slice(1, 3).map((item) => (
            <Link key={item.href} href={item.href} className="opacity-80">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function CtaLink({
  site,
  className = "",
  size = "md",
  label,
  href,
}: {
  site: SiteView;
  className?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
  href?: string;
}) {
  const target = href ?? site.cta.href;
  const external = href ? href.startsWith("http") : site.cta.external;
  const sizing = size === "sm" ? "px-4 py-2.5 text-sm" : size === "lg" ? "px-8 py-4 text-base" : "px-6 py-3.5 text-sm";
  return (
    <a
      href={target}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-bold shadow-lg transition hover:-translate-y-0.5 ${sizing} ${className}`}
      style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)", boxShadow: "0 16px 40px -18px var(--s-primary)" }}
    >
      {site.whatsapp ? <MessageCircle size={18} aria-hidden="true" /> : site.phone ? <Phone size={18} aria-hidden="true" /> : null}
      {label ?? site.cta.label}
    </a>
  );
}

export function SecondaryLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold transition hover:opacity-80 ${className}`}
      style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface)" }}
    >
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  tone = "plain",
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  children?: ReactNode;
  tone?: "plain" | "surface" | "primary";
  className?: string;
}) {
  const style: CSSProperties =
    tone === "primary"
      ? { backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }
      : tone === "surface"
        ? { backgroundColor: "var(--s-surface-strong)" }
        : {};
  return (
    <section id={id} className={`py-16 sm:py-24 ${className}`} style={style}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        {eyebrow || title || intro ? (
          <div className="max-w-2xl">
            {eyebrow ? (
              <p
                className="text-xs font-bold uppercase tracking-[0.22em]"
                style={{ color: tone === "primary" ? "var(--s-on-primary)" : "var(--s-accent)", opacity: tone === "primary" ? 0.8 : 1 }}
              >
                {eyebrow}
              </p>
            ) : null}
            {title ? <h2 className="mt-3 text-3xl sm:text-5xl">{title}</h2> : null}
            {intro ? (
              <p className="mt-4 text-base leading-7 sm:text-lg" style={{ color: tone === "primary" ? "var(--s-on-primary)" : "var(--s-muted)", opacity: tone === "primary" ? 0.85 : 1 }}>
                {intro}
              </p>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`overflow-hidden rounded-3xl border ${className}`}
      style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface)", ...style }}
    >
      {children}
    </div>
  );
}

export function MenuCard({
  site,
  item,
  compact = false,
}: {
  site: SiteView;
  item: SiteView["content"]["menu"][number];
  compact?: boolean;
}) {
  const photo = item.photoUrl ? item.photoUrl : null;
  const href = `${site.base}/servicos/${item.id}`;
  return (
    <Card className="group flex h-full flex-col transition hover:-translate-y-1">
      <Link href={href} className="block" aria-label={item.name}>
        {photo ? (
          <div className={`relative w-full overflow-hidden ${compact ? "aspect-[4/3]" : "aspect-[5/4]"}`}>
            <img
              src={photo}
              alt={item.photoAlt ?? item.name}
              className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
            <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
              Imagem ilustrativa
            </span>
          </div>
        ) : (
          <div
            className={`flex w-full items-end p-5 ${compact ? "aspect-[4/3]" : "aspect-[5/4]"}`}
            style={{ backgroundImage: "linear-gradient(135deg, color-mix(in srgb, var(--s-primary) 70%, transparent), color-mix(in srgb, var(--s-accent) 55%, transparent))" }}
          >
            <span className="text-4xl font-bold text-white drop-shadow">{item.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold leading-tight">
            <Link href={href}>{item.name}</Link>
          </h3>
          {item.price ? (
            <span className="shrink-0 rounded-full px-3 py-1 text-sm font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}>
              {item.price}
            </span>
          ) : null}
        </div>
        <p className="mt-2 flex-1 text-sm leading-6" style={{ color: "var(--s-muted)" }}>
          {item.summary}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link href={href} className="text-sm font-semibold" style={{ color: "var(--s-accent)" }}>
            Ver detalhes
          </Link>
          {site.whatsapp ? (
            <a
              href={site.whatsapp.href.replace(/text=.*$/, `text=${encodeURIComponent(`Olá! Quero ${site.family === "food" || site.family === "retail" ? "pedir" : "saber mais sobre"} "${item.name}".`)}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold"
              style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }}
            >
              <MessageCircle size={14} aria-hidden="true" /> {site.family === "food" || site.family === "retail" ? "Pedir" : "Falar"}
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function ContactCards({ site }: { site: SiteView }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {site.whatsapp ? (
        <a href={site.whatsapp.href} target="_blank" rel="noopener noreferrer" className="block">
          <Card className="flex h-full items-center gap-4 p-5 transition hover:-translate-y-0.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500">
              <MessageCircle size={22} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--s-muted)" }}>WhatsApp</span>
              <span className="mt-1 block truncate text-base font-bold">{site.whatsapp.display}</span>
            </span>
          </Card>
        </a>
      ) : null}
      {site.phone && (!site.whatsapp || site.phone.display !== site.whatsapp.display) ? (
        <a href={site.phone.href} className="block">
          <Card className="flex h-full items-center gap-4 p-5 transition hover:-translate-y-0.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}>
              <Phone size={22} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--s-muted)" }}>Telefone</span>
              <span className="mt-1 block truncate text-base font-bold">{site.phone.display}</span>
            </span>
          </Card>
        </a>
      ) : null}
      {site.address ? (
        <Card className="flex items-start gap-4 p-5 sm:col-span-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: "color-mix(in srgb, var(--s-accent) 18%, transparent)", color: "var(--s-accent)" }}>
            <MapPin size={22} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--s-muted)" }}>Endereço</span>
            <span className="mt-1 block text-base font-semibold leading-7">{site.address}</span>
            {site.map ? (
              <a href={site.map.external} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--s-accent)" }}>
                Abrir no mapa <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </span>
        </Card>
      ) : null}
      {site.content.openingHours.length ? (
        <Card className="flex items-start gap-4 p-5 sm:col-span-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}>
            <Clock size={22} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--s-muted)" }}>Horário</span>
            <ul className="mt-1 space-y-0.5 text-sm">
              {site.content.openingHours.map((slot) => (
                <li key={`${slot.day}-${slot.opens}`}>
                  <span className="font-semibold">{slot.day}</span>: {slot.opens} às {slot.closes}
                </li>
              ))}
            </ul>
          </span>
        </Card>
      ) : null}
    </div>
  );
}

export function MapFrame({ site, className = "" }: { site: SiteView; className?: string }) {
  if (!site.map) return null;
  return (
    <div className={`relative overflow-hidden rounded-3xl border ${className}`} style={{ borderColor: "var(--s-border)", minHeight: "20rem" }}>
      <iframe
        src={site.map.embed}
        title={`Mapa de ${site.business.name}`}
        className="absolute inset-0 h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-same-origin allow-scripts"
      />
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-medium text-white"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

export function SiteFooter({ site }: { site: SiteView }) {
  const credits = Array.from(
    new Set(
      [
        site.content.heroImageKind === "stock" ? site.content.heroImageCredit : null,
        ...site.content.galleryImages.map((image) => (image.kind === "stock" ? image.credit : null)),
        ...site.content.menu.map((item) => item.photoCredit),
      ].filter((credit): credit is string => Boolean(credit)),
    ),
  ).slice(0, 12);
  return (
    <footer className="border-t" style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface-strong)" }}>
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <p className="text-lg font-bold">{site.business.name}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--s-muted)" }}>{site.content.eyebrow ?? site.business.category}</p>
            <div className="mt-5">
              <CtaLink site={site} size="sm" />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--s-muted)" }}>Páginas</p>
            <ul className="mt-3 space-y-2 text-sm">
              {site.nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="opacity-85 hover:opacity-100">{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--s-muted)" }}>Contato</p>
            <ul className="mt-3 space-y-2 text-sm">
              {site.whatsapp ? <li>WhatsApp {site.whatsapp.display}</li> : null}
              {site.phone && (!site.whatsapp || site.phone.display !== site.whatsapp.display) ? <li>Telefone {site.phone.display}</li> : null}
              {site.address ? <li className="leading-6">{site.address}</li> : null}
              {site.socialLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 opacity-85 hover:opacity-100">
                    {link.label} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--s-border)", color: "var(--s-muted)" }}>
          <p>
            © {new Date().getFullYear()} {site.business.name}. Site criado por NOX OS.
            {site.isPermanent ? "" : ` Prévia válida até ${formatValidUntil(site.expiresAt)}.`}
          </p>
          {credits.length ? (
            <p className="max-w-xl">
              Fotos ilustrativas via <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="underline">Pexels</a>: {credits.join(", ")}.
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

export function MobileBar({ site }: { site: SiteView }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
      style={{ borderColor: "var(--s-border)", backgroundColor: "color-mix(in srgb, var(--s-bg) 92%, transparent)" }}
    >
      <CtaLink site={site} className="w-full" />
    </div>
  );
}
