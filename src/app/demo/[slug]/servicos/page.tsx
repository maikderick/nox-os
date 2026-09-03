import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";

import { Card, CtaLink, MenuCard, Section } from "@/components/site/shell";
import { loadSite } from "@/lib/site-view";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return {};
  return { title: result.site.menuLabel, description: result.site.content.servicesIntro };
}

export default async function ServicesPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return null;
  const { site } = result;
  const { content } = site;

  const featured = content.menu.filter((item) => item.featured);
  const hasMenu = content.menu.length > 0;

  return (
    <>
      <section className="pt-14 pb-4 sm:pt-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: "var(--s-accent)" }}>
            {site.business.name}
          </p>
          <h1 className="mt-3 text-4xl sm:text-6xl">{site.menuLabel}</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 sm:text-lg" style={{ color: "var(--s-muted)" }}>
            {content.servicesIntro}
          </p>
        </div>
      </section>

      {hasMenu ? (
        <>
          {featured.length ? (
            <Section id="destaques" eyebrow="Destaques" title="Os mais procurados" className="!pt-8 sm:!pt-12 !pb-6 sm:!pb-8">
              <div className="mt-10 grid gap-6 sm:grid-cols-2">
                {featured.map((item) => (
                  <MenuCard key={item.id} site={site} item={item} />
                ))}
              </div>
            </Section>
          ) : null}

          <Section
            id="todos"
            eyebrow={site.menuLabel}
            title={featured.length ? `Todo o ${site.menuLabel.toLocaleLowerCase("pt-BR")}` : `Conheça nosso ${site.menuLabel.toLocaleLowerCase("pt-BR")}`}
            className={featured.length ? "!pt-6 sm:!pt-8" : "!pt-8 sm:!pt-12"}
          >
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {content.menu.map((item) => (
                <MenuCard key={item.id} site={site} item={item} />
              ))}
            </div>
          </Section>
        </>
      ) : (
        <Section id="vazio" className="!pt-8 sm:!pt-12">
          <Card className="flex flex-col items-center gap-5 px-6 py-14 text-center sm:py-20">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "color-mix(in srgb, var(--s-primary) 16%, transparent)", color: "var(--s-primary)" }}
            >
              <MessageCircle size={26} aria-hidden="true" />
            </span>
            <h2 className="text-2xl sm:text-3xl">Fale com a gente para saber o que está disponível</h2>
            <p className="max-w-md text-sm leading-6 sm:text-base" style={{ color: "var(--s-muted)" }}>
              {content.servicesIntro}
            </p>
            <CtaLink site={site} size="lg" />
          </Card>
        </Section>
      )}

      <Section id="cta" tone="primary" eyebrow="Próximo passo" title={content.finalCtaTitle} intro={content.finalCtaText}>
        <div className="mt-10 inline-flex rounded-3xl bg-white p-3 shadow-xl">
          <CtaLink site={site} size="lg" />
        </div>
      </Section>
    </>
  );
}
