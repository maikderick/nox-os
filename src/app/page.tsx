import Link from "next/link";
import { ensureDefaultSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "NOX OS",
  url: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  description: "Sites personalizados para negócios locais.",
  areaServed: "BR",
};

const services = [
  ["Site institucional", "Uma página própria para explicar o negócio e orientar o contato."],
  ["Catálogo e cardápio", "Produtos e serviços organizados para consulta no celular."],
  ["Reservas e orçamentos", "Canais claros para receber pedidos sem criar etapas desnecessárias."],
] as const;

const processSteps = [
  ["Diagnóstico", "Reunimos as informações públicas e o objetivo do negócio."],
  ["Briefing", "Você confirma textos, serviços e canais antes da publicação."],
  ["Construção", "A página é montada com conteúdo e direção visual próprios."],
  ["Revisão", "A prévia fica disponível para ajustes antes de qualquer lançamento."],
] as const;

function configuredEmail(value: string): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return null;
  const domain = value.split("@").at(-1)?.toLowerCase() ?? "";
  if (
    domain.endsWith(".local") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid") ||
    domain === "example.com"
  ) return null;
  return value;
}

function configuredUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".test") ||
      host.endsWith(".invalid") ||
      host === "example.com"
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const settings = await ensureDefaultSettings();
  const portfolioUrl = configuredUrl(settings.portfolioUrl);
  const contactEmail = configuredEmail(settings.privacyEmail);

  return (
    <div className="min-h-screen bg-nox-bg text-nox-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="border-b border-nox-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            <span className="text-nox-cyan">NOX</span> OS
          </Link>
          <nav className="hidden gap-6 text-sm text-nox-muted md:flex" aria-label="Principal">
            <a href="#servicos" className="hover:text-white">Serviços</a>
            <a href="#processo" className="hover:text-white">Processo</a>
            <a href="#contato" className="hover:text-white">Contato</a>
          </nav>
          <details className="relative md:hidden">
            <summary className="list-none rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted">
              Menu
            </summary>
            <nav
              className="absolute right-0 top-12 z-20 grid min-w-40 gap-1 rounded-lg border border-nox-border bg-nox-surface p-2 text-sm shadow-xl"
              aria-label="Navegação principal"
            >
              <a href="#servicos" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Serviços</a>
              <a href="#processo" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Processo</a>
              <a href="#contato" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Contato</a>
              <Link href="/login" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Acessar painel</Link>
            </nav>
          </details>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted hover:text-white sm:inline-flex"
            >
              Acessar painel
            </Link>
            {contactEmail ? (
              <a
                href="#contato"
                className="hidden rounded-lg bg-nox-cyan px-4 py-2 text-sm font-semibold text-nox-bg hover:bg-cyan-300 sm:inline-flex"
              >
                Conversar sobre meu site
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-nox-border">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-28">
            <div>
              <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-nox-cyan">
                {settings.brandName}
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white md:text-6xl">
                Um site próprio para o seu negócio local ser encontrado e contatado.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-nox-muted">
                Organizamos informações confirmadas — serviços, localização e canais — em uma
                página clara, rápida e feita para a rotina de quem atende clientes.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {contactEmail ? (
                  <a
                    href="#contato"
                    className="rounded-lg bg-nox-cyan px-5 py-3 text-sm font-semibold text-nox-bg hover:bg-cyan-300"
                  >
                    Falar com a NOX OS
                  </a>
                ) : null}
                <a
                  href="#processo"
                  className="rounded-lg border border-nox-border px-5 py-3 text-sm text-nox-muted hover:border-nox-cyan hover:text-white"
                >
                  Entender o processo
                </a>
              </div>
            </div>

            <aside className="border-l-2 border-nox-purple pl-6 md:pl-8">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-nox-muted">
                O que entra no projeto
              </p>
              <ul className="mt-5 space-y-4 text-sm text-white">
                {[
                  "Informações do negócio confirmadas",
                  "Serviços e seções definidos no briefing",
                  "Canais públicos revisados antes de publicar",
                  "Prévia para revisar com calma",
                ].map((item) => (
                  <li key={item} className="flex gap-3 border-b border-nox-border pb-4 last:border-0">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-nox-cyan" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        <section id="servicos" className="border-b border-nox-border py-20">
          <div className="mx-auto max-w-6xl px-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-nox-cyan">Serviços</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">A página certa para a sua operação.</h2>
            <p className="mt-3 max-w-2xl text-nox-muted">
              Cada projeto começa pelo que seus clientes precisam saber para dar o próximo passo.
            </p>
            <ul className="mt-10 grid gap-px overflow-hidden border border-nox-border bg-nox-border md:grid-cols-3">
              {services.map(([title, description]) => (
                <li key={title} className="bg-nox-surface p-6">
                  <h3 className="text-lg font-medium text-white">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-nox-muted">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="processo" className="border-b border-nox-border bg-nox-surface/40 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-nox-cyan">Processo</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Clareza antes de publicar.</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-4">
              {processSteps.map(([title, description], index) => (
                <li key={title} className="border-t-2 border-nox-border pt-4">
                  <p className="font-mono text-sm text-nox-purple">0{index + 1}</p>
                  <h3 className="mt-4 font-medium text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-nox-muted">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="contato" className="border-b border-nox-border py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-nox-cyan">Contato</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">Vamos falar do seu negócio?</h2>
              <p className="mt-4 text-nox-muted">
                Envie os detalhes que já tiver. A conversa começa pelo seu contexto, sem promessa
                de resultado ou informação inventada.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {contactEmail ? (
                  <a
                    href={`mailto:${contactEmail}?subject=Site%20para%20meu%20negócio`}
                    className="rounded-lg bg-nox-cyan px-5 py-3 text-sm font-semibold text-nox-bg hover:bg-cyan-300"
                  >
                    Enviar e-mail
                  </a>
                ) : (
                  <p className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
                    O canal de contato ainda não foi configurado.
                  </p>
                )}
                {portfolioUrl ? (
                  <a
                    href={portfolioUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-nox-border px-5 py-3 text-sm text-nox-muted hover:border-nox-cyan hover:text-white"
                  >
                    Ver portfólio
                  </a>
                ) : null}
              </div>
              {contactEmail && settings.sellerName && !settings.sellerName.startsWith("[") ? (
                <p className="mt-5 text-sm text-nox-muted">Contato: {settings.sellerName}</p>
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <footer className="py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 text-sm text-nox-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {settings.brandName}. Todos os direitos reservados.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white">Política de privacidade</Link>
            <Link href="/login" className="hover:text-white">Acessar painel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
