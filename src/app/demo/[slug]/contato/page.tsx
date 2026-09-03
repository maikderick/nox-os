import type { Metadata } from "next";
import { ChevronDown, ExternalLink, MapPin } from "lucide-react";

import { Card, ContactCards, MapFrame, Section } from "@/components/site/shell";
import { loadSite } from "@/lib/site-view";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return {};
  return { title: "Contato", description: result.site.content.contactText };
}

export default async function ContactPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return null;
  const { site } = result;
  const { content } = site;

  return (
    <>
      <section className="pt-14 pb-16 sm:pt-20 sm:pb-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: "var(--s-accent)" }}>
            {site.locationShort ?? site.business.name}
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl sm:text-6xl">{content.contactTitle}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8" style={{ color: "var(--s-muted)" }}>
            {content.contactText}
          </p>

          <div className={`mt-12 grid gap-8 lg:items-stretch ${site.map || !site.address ? "lg:grid-cols-2" : ""}`}>
            <ContactCards site={site} />
            {site.map ? (
              <MapFrame site={site} className="min-h-[20rem] lg:min-h-full" />
            ) : site.address ? null : (
              <Card className="flex flex-col justify-center gap-4 p-8">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: "color-mix(in srgb, var(--s-accent) 18%, transparent)", color: "var(--s-accent)" }}
                >
                  <MapPin size={22} aria-hidden="true" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--s-muted)" }}>
                  Onde estamos
                </p>
                <p className="text-lg font-semibold leading-8">Endereço sob consulta</p>
              </Card>
            )}
          </div>

          {site.socialLinks.length ? (
            <div className="mt-12">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--s-muted)" }}>
                Redes sociais
              </p>
              <ul className="mt-4 flex flex-wrap gap-3">
                {site.socialLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
                      style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface)" }}
                    >
                      {link.label}
                      <ExternalLink size={14} aria-hidden="true" style={{ color: "var(--s-accent)" }} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {content.faqs.length ? (
        <Section id="faq" tone="surface" eyebrow="Dúvidas" title={content.faqTitle}>
          <div className="mt-10 grid gap-3 lg:max-w-3xl">
            {content.faqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border"
                style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface)" }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-base font-bold [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 transition-transform duration-300 group-open:rotate-180"
                    style={{ color: "var(--s-accent)" }}
                  />
                </summary>
                <p className="px-6 pb-6 text-sm leading-7 sm:text-base" style={{ color: "var(--s-muted)" }}>
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}
