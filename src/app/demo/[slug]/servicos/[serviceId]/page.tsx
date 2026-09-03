/* eslint-disable @next/next/no-img-element -- item photos come from validated runtime URLs */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { CtaLink, MenuCard, Section } from "@/components/site/shell";
import { itemWhatsAppLink, loadSite, safeImage } from "@/lib/site-view";

type PageProps = { params: Promise<{ slug: string; serviceId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, serviceId } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return {};
  const item = result.site.content.menu.find((entry) => entry.id === serviceId);
  if (!item) return {};
  return { title: item.name, description: item.summary };
}

export default async function ServiceItemPage({ params }: PageProps) {
  const { slug, serviceId } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return null;
  const { site } = result;
  const { content } = site;

  const item = content.menu.find((entry) => entry.id === serviceId);
  if (!item) notFound();

  const photo = safeImage(item.photoUrl);
  const whatsappHref = itemWhatsAppLink(site, item.name);
  const orderable = site.family === "food" || site.family === "retail";
  const ctaLabel = orderable ? "Pedir pelo WhatsApp" : "Falar sobre este serviço no WhatsApp";
  const related = content.menu.filter((entry) => entry.id !== item.id).slice(0, 3);
  const creditUrl = item.photoCreditUrl || null;

  return (
    <>
      <section className="pt-10 pb-16 sm:pt-14 sm:pb-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <nav aria-label="Navegação estrutural" className="text-sm">
            <Link
              href={`${site.base}/servicos`}
              className="inline-flex items-center gap-1.5 font-semibold transition hover:opacity-80"
              style={{ color: "var(--s-accent)" }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar para {site.menuLabel.toLocaleLowerCase("pt-BR")}
            </Link>
          </nav>

          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:items-start lg:gap-14">
            <div className="relative overflow-hidden rounded-3xl border" style={{ borderColor: "var(--s-border)" }}>
              {photo ? (
                <>
                  <img
                    src={photo}
                    alt={item.photoAlt ?? item.name}
                    className="aspect-[4/3] w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <span className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
                    Imagem ilustrativa
                  </span>
                  {item.photoCredit ? (
                    <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-[10px] font-medium text-white">
                      {creditUrl ? (
                        <a href={creditUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
                          Foto: {item.photoCredit} <ExternalLink size={10} aria-hidden="true" />
                        </a>
                      ) : (
                        <>Foto: {item.photoCredit}</>
                      )}
                    </span>
                  ) : null}
                </>
              ) : (
                <div
                  className="flex aspect-[4/3] w-full items-end p-8"
                  style={{ backgroundImage: "linear-gradient(135deg, color-mix(in srgb, var(--s-primary) 75%, transparent), color-mix(in srgb, var(--s-accent) 55%, transparent))" }}
                >
                  <span className="text-7xl font-bold text-white drop-shadow">{item.name.charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: "var(--s-accent)" }}>
                {site.menuLabel}
              </p>
              <h1 className="mt-3 text-4xl sm:text-5xl">{item.name}</h1>
              {item.price ? (
                <span
                  className="mt-5 inline-flex rounded-full px-4 py-1.5 text-base font-bold"
                  style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}
                >
                  {item.price}
                </span>
              ) : null}
              <p className="mt-6 text-lg leading-8" style={{ color: "var(--s-muted)" }}>
                {item.summary}
              </p>
              {item.body.length ? (
                <div className="mt-6 space-y-4 text-base leading-7">
                  {item.body.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {whatsappHref ? <CtaLink site={site} size="lg" href={whatsappHref} label={ctaLabel} /> : <CtaLink site={site} size="lg" />}
              </div>
            </div>
          </div>
        </div>
      </section>

      {related.length ? (
        <Section id="relacionados" tone="surface" eyebrow={site.menuLabel} title="Você também pode gostar">
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((entry) => (
              <MenuCard key={entry.id} site={site} item={entry} compact />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
