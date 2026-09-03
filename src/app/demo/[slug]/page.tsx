/* eslint-disable @next/next/no-img-element -- site images come from validated runtime URLs */
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, ExternalLink, MapPin, MessageCircle, Phone } from "lucide-react";

import { Card, ContactCards, CtaLink, MapFrame, MenuCard, SecondaryLink, Section } from "@/components/site/shell";
import { loadSite, safeImage, type SiteView } from "@/lib/site-view";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Which hero a sector gets. Food, hospitality and retail sell with a big
 * photo behind the name; clinics, offices and schools read better with a
 * calm split layout where the photo sits beside the text.
 */
function heroVariant(site: SiteView): "immersive" | "split" {
  const immersive: SiteView["family"][] = ["food", "hospitality", "retail", "fitness", "auto", "beauty"];
  return site.heroImage && immersive.includes(site.family) ? "immersive" : "split";
}

export default async function SiteHomePage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return null;
  const { site } = result;
  const { content, business } = site;

  const featured = content.menu.filter((item) => item.featured);
  const highlights = (featured.length ? featured : content.menu).slice(0, 3);
  const gallery = content.galleryImages.flatMap((image) => {
    const url = safeImage(image.url);
    return url ? [{ ...image, url }] : [];
  });
  const steps = content.processSteps.slice(0, 4);
  const variant = heroVariant(site);

  const trustLine = (
    <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium" style={{ color: "var(--s-muted)" }}>
      {site.whatsapp ? (
        <li className="inline-flex items-center gap-2">
          <MessageCircle size={16} className="text-emerald-500" aria-hidden="true" /> Atendimento pelo WhatsApp
        </li>
      ) : null}
      {site.locationShort ? (
        <li className="inline-flex items-center gap-2">
          <MapPin size={16} aria-hidden="true" /> {site.locationShort}
        </li>
      ) : null}
      {content.openingHours.length ? (
        <li className="inline-flex items-center gap-2">
          <Check size={16} aria-hidden="true" /> {content.openingHours[0].day}: {content.openingHours[0].opens} às {content.openingHours[0].closes}
        </li>
      ) : null}
    </ul>
  );

  const heroActions = (
    <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
      <CtaLink site={site} size="lg" />
      {content.menu.length ? (
        <SecondaryLink href={`${site.base}/servicos`}>Ver {site.menuLabel.toLowerCase()}</SecondaryLink>
      ) : (
        <SecondaryLink href={`${site.base}/sobre`}>Conheça {business.name}</SecondaryLink>
      )}
    </div>
  );

  const highlightsCard = highlights.length ? (
    <Card className="p-5" style={{ backgroundColor: "color-mix(in srgb, var(--s-surface) 92%, transparent)", backdropFilter: "blur(12px)" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--s-accent)" }}>
        {site.family === "food" ? "Mais pedidos" : "Destaques"}
      </p>
      <ul className="mt-3 divide-y" style={{ borderColor: "var(--s-border)" }}>
        {highlights.map((item) => {
          const photo = safeImage(item.photoUrl);
          return (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0" style={{ borderColor: "var(--s-border)" }}>
              <Link href={`${site.base}/servicos/${item.id}`} className="flex items-center gap-4">
                {photo ? (
                  <img src={photo} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 18%, transparent)", color: "var(--s-primary)" }}>
                    {item.name.charAt(0)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{item.name}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--s-muted)" }}>{item.summary}</span>
                </span>
                {item.price ? <span className="shrink-0 text-sm font-bold" style={{ color: "var(--s-primary)" }}>{item.price}</span> : <ChevronRight size={16} aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  ) : null;

  return (
    <>
      {variant === "immersive" ? (
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0">
            <img src={site.heroImage ?? ""} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  site.theme.mode === "dark"
                    ? "linear-gradient(90deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.66) 55%, rgba(0,0,0,.38) 100%)"
                    : "linear-gradient(90deg, rgba(255,255,255,.95) 0%, rgba(255,255,255,.8) 55%, rgba(255,255,255,.4) 100%)",
              }}
            />
          </div>
          <div className="relative mx-auto grid min-h-[72vh] max-w-6xl items-center gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em]" style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }}>
                {content.eyebrow ?? business.category}
              </p>
              <h1 className="mt-6 text-[clamp(3rem,8vw,6.5rem)] leading-[0.95]">{content.headline}</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 sm:text-xl" style={{ color: "var(--s-muted)" }}>{content.subheadline}</p>
              {heroActions}
              {trustLine}
            </div>
            <div className="hidden lg:block">{highlightsCard}</div>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 90% 10%, color-mix(in srgb, var(--s-accent) 22%, transparent), transparent 28rem), radial-gradient(circle at 0% 100%, color-mix(in srgb, var(--s-primary) 16%, transparent), transparent 30rem)",
            }}
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_0.9fr] lg:py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: "var(--s-primary)" }}>
                {content.eyebrow ?? business.category}
              </p>
              <h1 className="mt-5 text-[clamp(2.75rem,6.5vw,5.25rem)] leading-[1]">{content.headline}</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 sm:text-xl" style={{ color: "var(--s-muted)" }}>{content.subheadline}</p>
              {heroActions}
              {trustLine}
            </div>
            <div className="relative">
              <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[3rem] opacity-40 blur-3xl" style={{ backgroundColor: "var(--s-accent)" }} />
              {site.heroImage ? (
                <div className="relative aspect-[4/5] overflow-hidden rounded-[2.5rem] shadow-2xl sm:aspect-[5/4] lg:aspect-[4/5]">
                  <img src={site.heroImage} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" referrerPolicy="no-referrer" />
                  {content.heroImageKind === "stock" ? (
                    <span className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">Imagem ilustrativa</span>
                  ) : null}
                </div>
              ) : (
                <div className="flex aspect-[4/5] items-end rounded-[2.5rem] p-8 shadow-2xl sm:aspect-[5/4] lg:aspect-[4/5]" style={{ backgroundImage: "linear-gradient(145deg, var(--s-primary), color-mix(in srgb, var(--s-accent) 70%, var(--s-primary)))", color: "var(--s-on-primary)" }}>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-80">{business.category}</p>
                    <p className="mt-3 text-4xl font-bold leading-tight">{business.name}</p>
                    {site.locationShort ? <p className="mt-2 text-sm opacity-85">{site.locationShort}</p> : null}
                  </div>
                </div>
              )}
              {highlightsCard ? (
                <div className={site.heroImage ? "relative z-10 mx-4 -mt-10 lg:mx-6" : "relative z-10 mt-4"}>{highlightsCard}</div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {content.menu.length ? (
        <Section id="destaques" eyebrow={site.menuLabel} title={site.family === "food" ? "Os mais pedidos" : `${site.menuLabel} em destaque`} intro={content.servicesIntro}>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(featured.length ? featured : content.menu).slice(0, 6).map((item) => (
              <MenuCard key={item.id} site={site} item={item} />
            ))}
          </div>
          {content.menu.length > 3 ? (
            <div className="mt-8">
              <SecondaryLink href={`${site.base}/servicos`}>Ver {site.menuLabel.toLowerCase()} completo</SecondaryLink>
            </div>
          ) : null}
        </Section>
      ) : null}

      {content.benefits.length ? (
        <Section id="diferenciais" tone="surface" eyebrow="Por que escolher" title={`Por que ${business.name}`}>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {content.benefits.slice(0, 8).map((benefit, index) => (
              <li key={benefit}>
                <Card className="h-full p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold" style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-4 font-semibold leading-6">{benefit}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="como-funciona" eyebrow="Passo a passo" title={content.processTitle} intro={content.processIntro}>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step}>
              <Card className="h-full p-6">
                <span className="text-5xl font-bold leading-none" style={{ color: "var(--s-accent)" }}>{index + 1}</span>
                <p className="mt-5 text-base font-semibold leading-7">{step}</p>
              </Card>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <CtaLink site={site} />
        </div>
      </Section>

      {gallery.length ? (
        <Section id="galeria" tone="surface" eyebrow="Galeria" title={content.galleryTitle} intro={content.galleryIntro}>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.slice(0, 6).map((image) => (
              <figure key={image.url} className="relative aspect-[4/3] overflow-hidden rounded-3xl">
                <img src={image.url} alt={image.alt} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                {image.kind === "stock" ? (
                  <figcaption className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">Imagem ilustrativa</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </Section>
      ) : null}

      <Section id="onde-estamos" tone="primary" eyebrow="Onde estamos" title={site.address ? `Venha até ${business.name}` : `Fale com ${business.name}`}>
        <div className="mt-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="space-y-5">
            {site.address ? (
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><MapPin size={20} aria-hidden="true" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-75">Endereço</p>
                  <p className="mt-1 text-lg font-semibold leading-7">{site.address}</p>
                  {site.map ? (
                    <a href={site.map.external} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-white/40 underline-offset-4">
                      Abrir no mapa <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
            {content.openingHours.length ? (
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Check size={20} aria-hidden="true" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-75">Horário</p>
                  <ul className="mt-1 text-base font-semibold leading-7">
                    {content.openingHours.map((slot) => (
                      <li key={`${slot.day}-${slot.opens}`}>{slot.day}: {slot.opens} às {slot.closes}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
            {site.whatsapp ? (
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><MessageCircle size={20} aria-hidden="true" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-75">WhatsApp</p>
                  <a href={site.whatsapp.href} target="_blank" rel="noopener noreferrer" className="mt-1 block text-lg font-semibold underline decoration-white/40 underline-offset-4">{site.whatsapp.display}</a>
                </div>
              </div>
            ) : site.phone ? (
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Phone size={20} aria-hidden="true" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-75">Telefone</p>
                  <a href={site.phone.href} className="mt-1 block text-lg font-semibold underline decoration-white/40 underline-offset-4">{site.phone.display}</a>
                </div>
              </div>
            ) : null}
            <Link href={`${site.base}/contato`} className="inline-flex items-center gap-2 text-sm font-bold underline decoration-white/40 underline-offset-4">
              Todas as formas de contato <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          {site.map ? (
            <MapFrame site={site} className="min-h-[22rem] bg-white/10" />
          ) : (
            <div className="rounded-3xl bg-white/10 p-6">
              <ContactCards site={site} />
            </div>
          )}
        </div>
      </Section>

      <Section id="cta">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl sm:text-5xl">{content.finalCtaTitle}</h2>
          <p className="mt-5 text-base leading-7 sm:text-lg" style={{ color: "var(--s-muted)" }}>{content.finalCtaText}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaLink site={site} size="lg" />
          </div>
        </div>
      </Section>
    </>
  );
}
