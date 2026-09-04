import Link from "next/link";
import {
  CalendarCheck,
  CheckCircle2,
  Gauge,
  Mail,
  MapPinned,
  MessageCircle,
  Search,
  ShieldCheck,
  Smartphone,
  UtensilsCrossed,
} from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/shell/brand";
import { isHttpUrl, publicValue, whatsappLink } from "@/lib/brand";
import { NICHES } from "@/lib/niches";
import { ensureDefaultSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const settings = await ensureDefaultSettings();
  const brand = publicValue(settings.brandName) ?? "NOX OS";
  const city = publicValue(settings.defaultCity);
  const seller = publicValue(settings.sellerName);
  const email = publicValue(settings.privacyEmail);
  const portfolio = isHttpUrl(settings.portfolioUrl) ? settings.portfolioUrl.trim() : null;
  const whatsapp = whatsappLink(
    settings.whatsappPhone,
    `Olá! Vi o site da ${brand} e quero saber como funciona a criação de um site para o meu negócio.`,
  );
  const primaryHref = whatsapp ?? (email ? `mailto:${email}` : "#contato");
  const primaryLabel = whatsapp ? "Falar no WhatsApp" : "Falar com a equipe";
  const niches = NICHES.slice(0, 16);

  return (
    <div className="min-h-screen bg-nox-bg text-nox-text">
      <header className="sticky top-0 z-40 border-b border-nox-border/80 bg-nox-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight" aria-label={`${brand} — início`}>
            <BrandMark />
            <BrandWordmark name={brand} />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-nox-muted md:flex" aria-label="Seções">
            <a href="#entregas" className="hover:text-white">O que entregamos</a>
            <a href="#processo" className="hover:text-white">Como funciona</a>
            <a href="#segmentos" className="hover:text-white">Segmentos</a>
            <a href="#contato" className="hover:text-white">Contato</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="nox-btn-ghost hidden px-3 sm:inline-flex">
              Acessar painel
            </Link>
            <a href={primaryHref} className="nox-btn-primary px-4" target={whatsapp ? "_blank" : undefined} rel={whatsapp ? "noreferrer" : undefined}>
              <MessageCircle size={16} aria-hidden="true" /> {primaryLabel}
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="nox-glow relative overflow-hidden">
          <div className="nox-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-28 lg:pt-24">
            <div>
              <p className="nox-eyebrow">
                {brand}
                {city ? ` · ${city}` : ""}
              </p>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Sites profissionais para negócios locais que querem ser encontrados.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-nox-muted sm:text-lg">
                Páginas rápidas, com WhatsApp integrado e conteúdo construído só com o que o seu
                negócio realmente oferece. Do primeiro contato à publicação, com um processo claro
                e aprovação sua em cada etapa.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={primaryHref} className="nox-btn-primary px-6 py-3 text-base" target={whatsapp ? "_blank" : undefined} rel={whatsapp ? "noreferrer" : undefined}>
                  <MessageCircle size={18} aria-hidden="true" /> {primaryLabel}
                </a>
                <a href="#processo" className="nox-btn-secondary px-6 py-3 text-base">
                  Ver como funciona
                </a>
              </div>
              <ul className="mt-10 grid gap-3 text-sm text-nox-muted sm:grid-cols-3">
                {[
                  "Conteúdo só com fatos confirmados",
                  "Nada publicado sem a sua aprovação",
                  "WhatsApp integrado em todas as seções",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-nox-cyan" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <HeroPreview />
          </div>
        </section>

        {/* Deliverables */}
        <section id="entregas" className="border-t border-nox-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <p className="nox-eyebrow">O que entregamos</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Um site que trabalha pelo seu negócio todos os dias.
              </h2>
              <p className="mt-4 text-nox-muted">
                Cada página nasce do que o negócio faz de verdade: serviços, horários, endereço e
                canais de contato. Sem texto genérico, sem promessas inventadas.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Feature
                icon={<Smartphone size={20} />}
                title="Site institucional"
                text="Apresentação do negócio, serviços e diferenciais em uma página rápida, feita para celular."
              />
              <Feature
                icon={<UtensilsCrossed size={20} />}
                title="Cardápio e catálogo"
                text="Produtos e serviços organizados por categoria, com preços quando você quiser mostrá-los."
              />
              <Feature
                icon={<CalendarCheck size={20} />}
                title="WhatsApp e agendamento"
                text="Botão de contato em todas as seções, com mensagem pronta para pedido, orçamento ou reserva."
              />
              <Feature
                icon={<MapPinned size={20} />}
                title="Presença local no Google"
                text="Estrutura otimizada para buscas na sua cidade, com endereço, horários e mapa."
              />
            </div>
          </div>
        </section>

        {/* Process */}
        <section id="processo" className="border-t border-nox-border bg-nox-surface/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="nox-eyebrow">Como funciona</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Três etapas. Você acompanha todas.
                </h2>
                <p className="mt-4 text-nox-muted">
                  Um processo enxuto, pensado para quem não tem tempo de gerenciar projeto de site.
                  Você responde algumas perguntas, aprova a prévia e pronto.
                </p>
              </div>
              <ol className="space-y-4">
                <Step
                  number="01"
                  icon={<Search size={18} />}
                  title="Diagnóstico da presença digital"
                  text="Avaliamos como o seu negócio aparece hoje no Google, no mapa e nas redes, e o que está fazendo você perder contatos."
                />
                <Step
                  number="02"
                  icon={<ShieldCheck size={18} />}
                  title="Briefing confirmado com você"
                  text="Serviços, endereço, telefone e diferenciais entram no site somente depois de confirmados. Nada é inventado."
                />
                <Step
                  number="03"
                  icon={<Gauge size={18} />}
                  title="Prévia, aprovação e publicação"
                  text="Você recebe uma prévia navegável, pede ajustes e aprova. Publicamos com domínio próprio e acompanhamos o desempenho."
                />
              </ol>
            </div>
          </div>
        </section>

        {/* Niches */}
        <section id="segmentos" className="border-t border-nox-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <p className="nox-eyebrow">Segmentos</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Feito para o comércio e os serviços da sua cidade.
                </h2>
              </div>
              <p className="max-w-sm text-sm text-nox-muted">
                Cada segmento tem estrutura, vocabulário e chamadas de ação próprias. O site de uma
                hamburgueria não se parece com o de um escritório de advocacia.
              </p>
            </div>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {niches.map((niche) => {
                const Icon = niche.icon;
                return (
                  <li key={niche.id} className="nox-card flex items-center gap-3 px-4 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nox-cyan/10 text-nox-cyan">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">{niche.label}</span>
                      <span className="block truncate text-xs text-nox-muted">{niche.hint}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Why */}
        <section className="border-t border-nox-border bg-nox-surface/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="nox-eyebrow">Por que a {brand}</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Sério com o conteúdo, rápido na entrega.
                </h2>
                <p className="mt-4 text-nox-muted">
                  Um site bonito que promete o que o negócio não faz só gera reclamação. Por isso
                  trabalhamos com fatos confirmados e mostramos a prévia antes de publicar.
                </p>
                {portfolio ? (
                  <a href={portfolio} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-nox-cyan hover:underline">
                    Ver trabalhos publicados
                  </a>
                ) : null}
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Sem conteúdo inventado", "Só entra no site o que você confirma: serviços, contatos, endereço e horários."],
                  ["Rápido no celular", "Páginas leves, que abrem em segundos em qualquer conexão."],
                  ["WhatsApp em todas as seções", "O cliente nunca precisa procurar como falar com você."],
                  ["Você aprova antes", "Prévia navegável, ajustes e aprovação. Só depois publicamos."],
                ].map(([title, text]) => (
                  <li key={title} className="nox-card p-5">
                    <CheckCircle2 size={18} className="text-nox-cyan" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold text-white">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-nox-muted">{text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="contato" className="border-t border-nox-border">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="nox-glow relative overflow-hidden rounded-3xl border border-nox-border bg-nox-surface p-8 sm:p-12">
              <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
                <div>
                  <p className="nox-eyebrow">Vamos conversar</p>
                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Coloque o seu negócio na frente de quem está procurando.
                  </h2>
                  <p className="mt-4 max-w-lg text-nox-muted">
                    Conte em uma mensagem o que o seu negócio faz e onde fica. Respondemos com um
                    diagnóstico rápido e uma proposta sem compromisso.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <a href={primaryHref} className="nox-btn-primary px-6 py-3.5 text-base" target={whatsapp ? "_blank" : undefined} rel={whatsapp ? "noreferrer" : undefined}>
                    <MessageCircle size={18} aria-hidden="true" /> {primaryLabel}
                  </a>
                  {email ? (
                    <a href={`mailto:${email}`} className="nox-btn-secondary px-6 py-3.5 text-base">
                      <Mail size={18} aria-hidden="true" /> {email}
                    </a>
                  ) : null}
                  {seller ? (
                    <p className="text-center text-xs text-nox-muted">Atendimento com {seller}.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-nox-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-nox-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {brand}
            {city ? ` · ${city}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/privacy" className="hover:text-white">Privacidade</Link>
            {email ? (
              <a href={`mailto:${email}`} className="hover:text-white">{email}</a>
            ) : null}
            <Link href="/login" className="hover:text-white">Painel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="nox-card p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-nox-cyan/10 text-nox-cyan" aria-hidden="true">{icon}</span>
      <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-nox-muted">{text}</p>
    </article>
  );
}

function Step({ number, icon, title, text }: { number: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="nox-card flex gap-5 p-6">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-xs text-nox-cyan">{number}</span>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-nox-border bg-nox-panel text-nox-cyan" aria-hidden="true">{icon}</span>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-nox-muted">{text}</p>
      </div>
    </li>
  );
}

/**
 * A stylised preview of a generated site, built from plain elements so it
 * never goes stale and never shows a real client's content.
 */
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[2rem] bg-linear-to-br from-nox-cyan/15 via-transparent to-nox-purple/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-nox-border bg-nox-surface shadow-2xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-nox-border bg-nox-panel px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-nox-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-nox-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-nox-border-strong" />
          <span className="ml-3 h-5 flex-1 rounded-md bg-nox-bg/80 px-2 text-[10px] leading-5 text-nox-muted">
            seunegocio.com.br
          </span>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-[1.2fr_1fr] gap-4">
            <div className="space-y-2.5">
              <div className="h-2 w-16 rounded bg-nox-cyan/60" />
              <div className="h-4 w-full rounded bg-white/80" />
              <div className="h-4 w-4/5 rounded bg-white/60" />
              <div className="h-2.5 w-full rounded bg-nox-border-strong" />
              <div className="h-2.5 w-5/6 rounded bg-nox-border-strong" />
              <div className="flex gap-2 pt-1">
                <div className="h-7 w-24 rounded-md bg-nox-cyan" />
                <div className="h-7 w-20 rounded-md border border-nox-border-strong" />
              </div>
            </div>
            <div className="rounded-xl bg-linear-to-br from-nox-purple/40 via-nox-panel to-nox-cyan/30" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="space-y-2 rounded-lg border border-nox-border bg-nox-panel p-3">
                <div className="h-14 rounded-md bg-nox-raised" />
                <div className="h-2 w-3/4 rounded bg-white/60" />
                <div className="h-2 w-1/2 rounded bg-nox-border-strong" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-nox-border bg-nox-panel px-3 py-2.5">
            <div className="space-y-1.5">
              <div className="h-2 w-24 rounded bg-white/60" />
              <div className="h-2 w-32 rounded bg-nox-border-strong" />
            </div>
            <div className="h-7 w-28 rounded-md bg-emerald-400/80" />
          </div>
        </div>
      </div>

      <div className="absolute -left-4 top-10 hidden rounded-xl border border-nox-border bg-nox-panel/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:block">
        <p className="text-[10px] text-nox-muted">Feito para</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
          <Smartphone size={14} className="text-nox-cyan" /> Celular primeiro
        </p>
      </div>
      <div className="absolute -bottom-5 -right-3 hidden rounded-xl border border-nox-border bg-nox-panel/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:block">
        <p className="text-[10px] text-nox-muted">Contato</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
          <MessageCircle size={14} className="text-emerald-300" /> WhatsApp em 1 toque
        </p>
      </div>
    </div>
  );
}
