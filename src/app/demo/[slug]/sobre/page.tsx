/* eslint-disable @next/next/no-img-element -- gallery images come from validated runtime URLs */
import type { Metadata } from "next";
import { Check } from "lucide-react";

import { Card, CtaLink, Section } from "@/components/site/shell";
import { loadSite, safeImage } from "@/lib/site-view";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return {};
  return { title: "Sobre", description: result.site.content.about };
}

export default async function AboutPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return null;
  const { site } = result;
  const { content } = site;

  const gallery = content.galleryImages
    .map((image) => ({ ...image, src: safeImage(image.url) }))
    .filter((image): image is typeof image & { src: string } => image.src !== null);

  return (
    <>
      <section className="pt-14 pb-16 sm:pt-20 sm:pb-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: "var(--s-accent)" }}>
            {content.eyebrow ?? site.business.category}
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl sm:text-6xl">{content.aboutTitle}</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8" style={{ color: "var(--s-muted)" }}>
            {content.about}
          </p>
        </div>
      </section>

      {content.benefits.length ? (
        <Section id="diferenciais" tone="surface" eyebrow="Diferenciais" title={content.factsTitle}>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {content.benefits.map((benefit) => (
              <Card key={benefit} className="flex items-start gap-4 p-5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}
                >
                  <Check size={18} aria-hidden="true" />
                </span>
                <p className="text-base font-semibold leading-6">{benefit}</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {gallery.length ? (
        <Section id="galeria" eyebrow="Galeria" title={content.galleryTitle} intro={content.galleryIntro}>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((image) => (
              <figure
                key={image.src}
                className="relative overflow-hidden rounded-3xl border"
                style={{ borderColor: "var(--s-border)", backgroundColor: "var(--s-surface)" }}
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
                {image.kind === "stock" ? (
                  <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
                    Imagem ilustrativa
                  </span>
                ) : null}
                {image.kind === "stock" && image.credit ? (
                  <figcaption className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-[10px] font-medium text-white">
                    Foto: {image.credit}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </Section>
      ) : null}

      {content.processSteps.length ? (
        <Section id="como-funciona" tone={gallery.length ? "surface" : "plain"} eyebrow="Passo a passo" title={content.processTitle} intro={content.processIntro}>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {content.processSteps.map((step, index) => (
              <li key={step} className="h-full">
                <Card className="flex h-full flex-col gap-4 p-6">
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-base font-bold"
                    style={{ backgroundColor: "var(--s-primary)", color: "var(--s-on-primary)" }}
                  >
                    {index + 1}
                  </span>
                  <p className="text-base leading-7">{step}</p>
                </Card>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section id="cta" tone="surface" eyebrow="Próximo passo" title={content.finalCtaTitle} intro={content.finalCtaText}>
        <div className="mt-8">
          <CtaLink site={site} size="lg" />
        </div>
      </Section>
    </>
  );
}
