import Link from "next/link";
import { ensureDefaultSettings } from "@/lib/settings";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "NOX OS",
  url: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  description: "Sites personalizados que transformam negócios locais.",
  areaServed: "BR",
};

export default async function HomePage() {
  const settings = await ensureDefaultSettings();

  return (
    <div className="nox-grid min-h-screen text-nox-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="relative border-b border-nox-border/80">
        <div className="nox-glow absolute inset-0 -z-10" />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            <span className="text-nox-cyan">NOX</span> <span className="text-white">OS</span>
          </Link>
          <nav className="hidden gap-6 text-sm text-nox-muted md:flex" aria-label="Principal">
            <a href="#servicos" className="hover:text-white">
              Serviços
            </a>
            <a href="#beneficios" className="hover:text-white">
              Benefícios
            </a>
            <a href="#processo" className="hover:text-white">
              Processo
            </a>
            <a href="#portfolio" className="hover:text-white">
              Portfólio
            </a>
            <a href="#contato" className="hover:text-white">
              Contato
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted hover:text-white"
            >
              Acessar painel
            </Link>
            <a
              href="#contato"
              className="rounded-lg bg-gradient-to-r from-nox-purple to-nox-blue px-4 py-2 text-sm font-medium text-white"
            >
              Solicitar análise
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="nox-glow absolute inset-0 -z-10" />
          <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-16 md:grid-cols-[1.2fr_0.8fr] md:pt-24">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-nox-cyan">
                {settings.brandName}
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                Sites personalizados que transformam negócios locais
              </h1>
              <p className="mt-6 max-w-xl text-lg text-nox-muted">
                Presença digital com autoridade, geração de contatos e experiências sob medida
                para o seu segmento — do cardápio à reserva, do catálogo à conversão.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#contato"
                  className="rounded-lg bg-nox-cyan px-5 py-3 text-sm font-semibold text-nox-bg"
                >
                  Quero uma análise gratuita
                </a>
                <a
                  href="#processo"
                  className="rounded-lg border border-nox-border px-5 py-3 text-sm text-nox-muted hover:border-nox-purple hover:text-white"
                >
                  Ver como funciona
                </a>
              </div>
            </div>
            <div
              className="relative min-h-[280px] rounded-2xl border border-nox-border bg-nox-surface p-6"
              aria-hidden
            >
              <div className="absolute inset-6 rounded-xl bg-gradient-to-br from-nox-purple/30 via-transparent to-nox-cyan/20" />
              <div className="relative space-y-4">
                <div className="h-3 w-24 rounded bg-nox-cyan/40" />
                <div className="h-8 w-3/4 rounded bg-white/10" />
                <div className="h-3 w-full rounded bg-white/5" />
                <div className="h-3 w-5/6 rounded bg-white/5" />
                <div className="mt-8 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-nox-border/80 bg-nox-panel p-4">
                    <p className="text-xs text-nox-muted">Conversão</p>
                    <p className="mt-2 text-2xl font-semibold text-nox-cyan">+ leads</p>
                  </div>
                  <div className="rounded-lg border border-nox-border/80 bg-nox-panel p-4">
                    <p className="text-xs text-nox-muted">Identidade</p>
                    <p className="mt-2 text-2xl font-semibold text-nox-purple">única</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="servicos" className="border-t border-nox-border bg-nox-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Serviços</h2>
            <p className="mt-3 max-w-2xl text-nox-muted">
              Projetos digitais sob medida para negócios locais que precisam vender e atender
              melhor online.
            </p>
            <ul className="mt-10 grid gap-6 md:grid-cols-3">
              {[
                ["Site institucional", "Posicionamento, autoridade e contato direto."],
                ["Catálogo e cardápio", "Vitrine clara de produtos e serviços."],
                ["Reservas e orçamentos", "Fluxos simples para gerar demanda qualificada."],
              ].map(([title, desc]) => (
                <li key={title} className="rounded-xl border border-nox-border bg-nox-panel p-6">
                  <h3 className="text-lg font-medium text-white">{title}</h3>
                  <p className="mt-2 text-sm text-nox-muted">{desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="beneficios" className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Benefícios</h2>
            <p className="mt-3 text-nox-muted">Resultados práticos para o dia a dia do negócio.</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "Presença digital profissional",
                "Geração de contatos",
                "Catálogo online",
                "Reservas e agendamentos",
                "Cardápio digital",
                "Autoridade e vendas",
              ].map((item) => (
                <li
                  key={item}
                  className="rounded-lg border border-nox-border/70 bg-nox-surface px-4 py-3 text-sm"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="processo" className="border-y border-nox-border bg-nox-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Processo</h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-4">
              {[
                ["01", "Diagnóstico", "Entendemos o negócio e a oportunidade digital."],
                ["02", "Proposta", "Escopo, páginas e objetivos claros."],
                ["03", "Construção", "Design e desenvolvimento com identidade própria."],
                ["04", "Lançamento", "Publicação, ajustes e acompanhamento."],
              ].map(([n, t, d]) => (
                <li key={n} className="rounded-xl border border-nox-border bg-nox-panel p-5">
                  <p className="font-mono text-nox-cyan">{n}</p>
                  <h3 className="mt-2 font-medium text-white">{t}</h3>
                  <p className="mt-2 text-sm text-nox-muted">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="portfolio" className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Portfólio</h2>
            <p className="mt-3 text-nox-muted">
              Placeholders fáceis de substituir.{" "}
              <a className="text-nox-cyan underline" href={settings.portfolioUrl}>
                Ver portfólio
              </a>
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {["Projeto Alfa", "Projeto Beta", "Projeto Gama"].map((name) => (
                <article
                  key={name}
                  className="min-h-[180px] rounded-xl border border-dashed border-nox-border bg-nox-surface p-6"
                >
                  <p className="text-xs uppercase tracking-wider text-nox-muted">Placeholder</p>
                  <h3 className="mt-3 text-lg text-white">{name}</h3>
                  <p className="mt-2 text-sm text-nox-muted">Substitua por case real da NOX OS.</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-nox-border py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Depoimentos</h2>
            <p className="mt-2 text-sm text-amber-300/90">
              Exemplos ilustrativos — substitua por depoimentos reais quando disponíveis.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {[
                [
                  "Exemplo — Clínica local",
                  "O site ajudou a organizar o atendimento e aumentar contatos qualificados.",
                ],
                [
                  "Exemplo — Restaurante",
                  "Cardápio e reservas em um só lugar reforçaram a presença digital.",
                ],
              ].map(([who, quote]) => (
                <blockquote
                  key={who}
                  className="rounded-xl border border-nox-border bg-nox-panel p-6 text-nox-muted"
                >
                  <p>“{quote}”</p>
                  <footer className="mt-4 text-sm text-white">{who}</footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        <section id="contato" className="border-t border-nox-border bg-nox-surface/50 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold text-white">Solicite uma análise ou orçamento</h2>
            <p className="mt-3 max-w-xl text-nox-muted">
              Fale com {settings.sellerName} · {settings.defaultCity}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href={`mailto:${settings.privacyEmail}?subject=Análise%20NOX%20OS`}
                className="rounded-lg bg-gradient-to-r from-nox-purple to-nox-blue px-5 py-3 text-sm font-medium"
              >
                Enviar e-mail
              </a>
              <a
                href={settings.portfolioUrl}
                className="rounded-lg border border-nox-border px-5 py-3 text-sm text-nox-muted hover:text-white"
              >
                Ver portfólio
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-nox-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 text-sm text-nox-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {settings.brandName}. Todos os direitos reservados.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="hover:text-white">
              Política de privacidade
            </Link>
            <a href={`mailto:${settings.privacyEmail}`} className="hover:text-white">
              Privacidade
            </a>
            <span>Instagram / LinkedIn (placeholders)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
