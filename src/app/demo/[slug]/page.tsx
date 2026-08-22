import type { CSSProperties } from "react";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isDemoLandingExpired } from "@/lib/demo-landing";
import { parseDemoLandingContent } from "@/lib/demo-landing-schema";
import { hasOwnWebsite } from "@/lib/website";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

const getDemo = cache(async (slug: string) =>
  prisma.demoLanding.findUnique({
    where: { slug },
    include: { business: true },
  }),
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await getDemo(slug);
  const title = landing ? `Demonstração — ${landing.business.name}` : "Demonstração indisponível";

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
        <p className="mt-8 text-xs uppercase tracking-[0.16em] text-slate-600">Criado com NOX OS</p>
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

  if (hasOwnWebsite(landing.business.website)) {
    return <UnavailableDemo />;
  }

  let content;
  try {
    content = parseDemoLandingContent(landing.contentJson);
  } catch {
    return <UnavailableDemo />;
  }

  const business = landing.business;
  const location = [business.city, business.state].filter(Boolean).join(" — ");
  const theme = {
    "--demo-primary": content.primaryColor,
    "--demo-accent": content.accentColor,
  } as CSSProperties;

  return (
    <main
      className="min-h-screen overflow-hidden bg-[#08080c] text-slate-50"
      style={theme}
    >
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[34rem] opacity-50 blur-3xl"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 10%, ${content.primaryColor}55, transparent 42%), radial-gradient(circle at 80% 0%, ${content.accentColor}44, transparent 38%)`,
        }}
      />

      <div className="relative z-10 border-b border-amber-200/15 bg-amber-100/[0.06] px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100 sm:text-xs">
        Demonstração não oficial · Prévia temporária criada pela NOX OS
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between py-7">
          <span className="text-lg font-semibold tracking-tight">{business.name}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
            Prévia
          </span>
        </nav>

        <section className="grid min-h-[32rem] items-center gap-12 py-12 lg:grid-cols-[1.25fr_0.75fr] lg:py-20">
          <div>
            <div
              className="mb-6 w-fit rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em]"
              style={{
                borderColor: `${content.accentColor}55`,
                backgroundColor: `${content.accentColor}18`,
                color: content.accentColor,
              }}
            >
              {business.category}
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              {content.headline}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              {content.subheadline}
            </p>
            <a
              href="#informacoes"
              className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
              style={{
                backgroundImage: `linear-gradient(135deg, ${content.primaryColor}, ${content.accentColor})`,
                boxShadow: `0 18px 45px ${content.primaryColor}33`,
              }}
            >
              {content.ctaLabel}
            </a>
          </div>

          <aside
            id="informacoes"
            className="scroll-mt-8 rounded-[2rem] border border-white/10 bg-white/[0.055] p-7 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Informações cadastradas
            </p>
            <dl className="mt-6 space-y-5">
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Categoria</dt>
                <dd className="mt-1.5 text-base text-slate-100">{business.category}</dd>
              </div>
              {location ? (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-slate-500">Cidade</dt>
                  <dd className="mt-1.5 text-base text-slate-100">{location}</dd>
                </div>
              ) : null}
              {business.neighborhood ? (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-slate-500">Bairro</dt>
                  <dd className="mt-1.5 text-base text-slate-100">{business.neighborhood}</dd>
                </div>
              ) : null}
              {business.address ? (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-slate-500">Endereço informado</dt>
                  <dd className="mt-1.5 text-base leading-7 text-slate-100">{business.address}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        </section>

        <section className="grid gap-6 py-12 lg:grid-cols-2">
          <article className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-7 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sobre</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Uma apresentação objetiva</h2>
            <p className="mt-5 leading-8 text-slate-300">{content.about}</p>
          </article>

          {content.benefits.length ? (
            <article className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-7 sm:p-9">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Dados confirmados
              </p>
              <ul className="mt-5 space-y-3">
                {content.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-3 leading-7 text-slate-300">
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: content.accentColor }}
                    />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </section>

        {content.services.length ? (
          <section className="my-12 rounded-[2rem] border border-white/10 bg-white/[0.035] p-7 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Serviços informados
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {content.services.map((service) => (
                <div key={service} className="rounded-2xl border border-white/10 bg-black/15 p-5 text-slate-200">
                  {service}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="mt-16 border-t border-white/10 pt-8 text-center">
          <p className="text-sm leading-6 text-slate-500">
            Esta é uma demonstração não oficial, criada para apresentação visual. Não constitui o
            site oficial do estabelecimento.
          </p>
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-700">
            NOX OS · Demonstração temporária
          </p>
        </footer>
      </div>
    </main>
  );
}
