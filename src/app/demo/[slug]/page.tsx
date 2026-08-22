import type { CSSProperties } from "react";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  Compass,
  Info,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { isDemoLandingExpired } from "@/lib/demo-landing";
import {
  normalizeDemoCtaLabel,
  parseDemoLandingContent,
} from "@/lib/demo-landing-schema";
import { hasOwnWebsite } from "@/lib/website";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

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
  const locationSummary = [business.neighborhood, location].filter(Boolean).join(", ");
  const hasLocationDetails = Boolean(
    locationSummary || business.address || business.postalCode,
  );
  const locationHeadline = locationSummary || business.address || business.name;
  const businessInitial = business.name.trim().charAt(0).toUpperCase() || "N";
  const accentTextColor = readableAccentColor(content.accentColor);
  const ctaLabel = normalizeDemoCtaLabel(content.ctaLabel);
  const accessibleGradient = `linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58)), linear-gradient(135deg, ${content.primaryColor}, ${content.accentColor})`;
  const availableData = [
    { label: "Categoria", value: business.category, icon: Building2 },
    location ? { label: "Cidade e estado", value: location, icon: Compass } : null,
    business.neighborhood
      ? { label: "Bairro", value: business.neighborhood, icon: MapPin }
      : null,
    business.address ? { label: "Endereço", value: business.address, icon: MapPin } : null,
    business.postalCode ? { label: "CEP", value: business.postalCode, icon: MapPin } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const theme = {
    "--demo-primary": content.primaryColor,
    "--demo-accent": content.accentColor,
  } as CSSProperties;

  return (
    <main
      className="min-h-screen overflow-hidden bg-[#07070a] text-slate-50 selection:bg-white/20"
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

      <div className="relative z-50 border-b border-amber-200/15 bg-amber-100/[0.07] px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.17em] text-amber-100 sm:text-[11px]">
        <span className="inline-flex items-center justify-center gap-2">
          <Info aria-hidden="true" className="h-3.5 w-3.5" />
          Demonstração não oficial · Esta página é uma prévia temporária
        </span>
      </div>

      <div className="relative z-10">
        <nav className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#07070a]/80 backdrop-blur-2xl">
          <div className="mx-auto flex h-[4.75rem] max-w-7xl items-center justify-between gap-5 px-5 sm:px-8 lg:px-10">
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
              <a className="transition hover:text-white" href="#localizacao">
                Localização
              </a>
              {content.faqs.length ? (
                <a className="transition hover:text-white" href="#duvidas">
                  Dúvidas
                </a>
              ) : null}
            </div>

            <a
              href="#localizacao"
              className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.11] sm:px-5 sm:text-sm"
            >
              {ctaLabel}
              <ArrowDownRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5"
              />
            </a>
          </div>
        </nav>

        <section
          id="inicio"
          className="mx-auto grid min-h-[calc(100vh-7.5rem)] max-w-7xl scroll-mt-24 items-center gap-14 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-24"
        >
          <div className="max-w-3xl">
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
            <h1 className="text-[clamp(3.25rem,7vw,6.6rem)] font-semibold leading-[0.94] tracking-[-0.058em] text-white">
              {content.headline}
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg sm:leading-9">
              {content.subheadline}
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="#localizacao"
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
                style={{
                  backgroundImage: accessibleGradient,
                  boxShadow: `0 20px 55px ${content.primaryColor}30`,
                }}
              >
                {ctaLabel}
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

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-slate-400" />
                Informações disponíveis
              </span>
              <span className="inline-flex items-center gap-2">
                <BadgeCheck aria-hidden="true" className="h-4 w-4 text-slate-400" />
                Conteúdo claro e transparente
              </span>
            </div>
          </div>

          <aside className="relative mx-auto w-full max-w-xl lg:ml-auto">
            <div
              aria-hidden="true"
              className="absolute -inset-8 -z-10 rounded-full opacity-25 blur-3xl"
              style={{ backgroundColor: content.primaryColor }}
            />
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#101016]/90 shadow-2xl shadow-black/50 backdrop-blur-2xl sm:rounded-[2.5rem]">
              <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-5 sm:px-8">
                <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.7)]" />
                  Perfil do estabelecimento
                </span>
                <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Prévia
                </span>
              </div>

              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-4">
                  <span
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white"
                    style={{ backgroundImage: accessibleGradient }}
                  >
                    {businessInitial}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
                      {business.name}
                    </h2>
                    <p className="mt-1 truncate text-sm text-slate-400">{business.category}</p>
                  </div>
                </div>

                <dl className="mt-8 grid gap-3">
                  {availableData.slice(0, 4).map(({ label, value, icon: Icon }) => (
                    <div
                      key={label}
                      className="flex items-start gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-slate-300">
                        <Icon aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                          {label}
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-slate-200">{value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>

                <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.055] p-4 text-xs leading-5 text-emerald-100/70">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  As informações acima foram organizadas a partir dos dados disponíveis sobre o estabelecimento.
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section
          id="sobre"
          className="mx-auto grid max-w-7xl scroll-mt-28 gap-12 border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-28 lg:grid-cols-[0.75fr_1.25fr] lg:px-10 lg:py-36"
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
            <div className="mt-9 flex items-center gap-3 text-sm text-slate-500">
              <span className="h-px w-10 bg-white/15" />
              {business.category}{location ? ` em ${location}` : ""}
            </div>
          </div>
        </section>

        {content.services.length ? (
          <section
            id="servicos"
            className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
          >
            <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
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
                        className="h-5 w-5 text-slate-700 transition group-hover:text-slate-400"
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
            className="mx-auto max-w-7xl scroll-mt-28 px-5 py-24 sm:px-8 sm:py-28 lg:px-10 lg:py-36"
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
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-slate-700">
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
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
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
                        className="hidden h-5 w-5 shrink-0 text-slate-700 transition group-hover:translate-x-1 group-hover:text-slate-400 sm:block"
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section
          id="localizacao"
          className="mx-auto grid max-w-7xl scroll-mt-28 gap-10 px-5 py-24 sm:px-8 sm:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:py-36"
        >
          <div
            className="relative min-h-[27rem] overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] p-7 sm:p-10"
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
            <div className="relative flex h-full min-h-[21rem] flex-col justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {hasLocationDetails ? "Onde estamos" : "Sobre o estabelecimento"}
                </p>
                <h2 className="mt-5 max-w-lg text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
                  {locationHeadline}
                </h2>
              </div>

              <div className="flex items-end justify-between gap-6">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-2xl"
                  style={{
                    backgroundImage: accessibleGradient,
                    boxShadow: `0 16px 50px ${content.primaryColor}45`,
                  }}
                >
                  <MapPin aria-hidden="true" className="h-6 w-6" />
                </div>
                <span className="max-w-xs text-right text-xs leading-5 text-slate-500">
                  Exibição ilustrativa baseada apenas nas informações disponíveis.
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <p
              className="text-xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: accentTextColor }}
            >
              Dados do estabelecimento
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">
              {hasLocationDetails
                ? `Informações para encontrar ${business.name}`
                : `Informações disponíveis sobre ${business.name}`}
            </h2>
            <dl className="mt-10 divide-y divide-white/[0.07] border-y border-white/[0.07]">
              {availableData.map(({ label, value, icon: Icon }) => (
                <div key={label} className="grid gap-2 py-5 sm:grid-cols-[9rem_1fr] sm:gap-5">
                  <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                    <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    {label}
                  </dt>
                  <dd className="text-sm leading-7 text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {content.faqs.length ? (
          <section
            id="duvidas"
            className="scroll-mt-28 border-y border-white/[0.07] bg-white/[0.018] py-24 sm:py-28"
          >
            <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:px-10">
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
                    <span className="pt-1 text-[10px] font-semibold tracking-[0.16em] text-slate-700">
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

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
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
                href="#localizacao"
                className="group mt-9 inline-flex min-h-14 items-center justify-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5"
                style={{
                  backgroundImage: accessibleGradient,
                  boxShadow: `0 20px 55px ${content.primaryColor}30`,
                }}
              >
                {ctaLabel}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                />
              </a>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/[0.07]">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-center sm:px-8 md:grid-cols-[1fr_auto] md:items-center md:text-left lg:px-10">
            <div>
              <p className="text-sm font-semibold text-slate-300">{business.name}</p>
              <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-600">
                Demonstração não oficial criada para apresentação visual. Esta página não constitui
                o site oficial do estabelecimento.
              </p>
            </div>
            <div className="md:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                NOX OS · Demonstração temporária
              </p>
              <p className="mt-2 text-[10px] text-slate-700">Conteúdo sujeito à validação do estabelecimento</p>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
