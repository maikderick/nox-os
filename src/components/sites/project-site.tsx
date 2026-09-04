import { ExternalLink, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import {
  briefPublicContact,
  isSiteBriefV2,
  type SiteBrief,
} from "@/lib/site-factory/brief-schema";

function addressText(address: {
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  country: string;
}) {
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join(" — "),
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ProjectSite({ brief }: { brief: SiteBrief }) {
  const contact = briefPublicContact(brief);
  const services = isSiteBriefV2(brief)
    ? brief.services.map((service) => ({
        id: service.id,
        name: service.name.value,
        summary: service.summary.value,
        body: service.body.map((paragraph) => paragraph.value),
      }))
    : brief.services.map((service, index) => ({
        id: `servico-${index + 1}`,
        name: service.value,
        summary: "",
        body: [] as string[],
      }));

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#08090d] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#08090d]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 sm:px-8">
          <a href="#inicio" className="min-w-0 truncate text-sm font-semibold tracking-tight text-white">
            {brief.businessName.value}
          </a>
          <nav aria-label="Navegação do site" className="flex items-center gap-5 text-xs font-medium text-slate-300">
            {services.length ? <a href="#servicos" className="hover:text-white">Serviços</a> : null}
            <a href="#contato" className="rounded-full border border-white/15 px-4 py-2 hover:border-cyan-300/50 hover:text-white">Contato</a>
          </nav>
        </div>
      </header>

      <section id="inicio" className="border-b border-white/10 bg-[radial-gradient(circle_at_85%_20%,rgba(34,211,238,.14),transparent_34%),radial-gradient(circle_at_10%_80%,rgba(139,92,246,.14),transparent_36%)]">
        <div className="mx-auto grid min-h-[75vh] max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.2fr_.8fr] lg:py-28">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">{brief.sector.value}</p>
            <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.05em] sm:text-7xl">{brief.businessName.value}</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">{brief.positioning.value}</p>
            <a href="#contato" className="mt-9 inline-flex rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-100">Entrar em contato</a>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-7 shadow-2xl shadow-cyan-950/20 sm:p-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Apresentação</p>
            <p className="mt-5 text-xl leading-9 text-slate-100">{brief.objective.value}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Sobre</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Informação clara para decidir o próximo passo.</h2>
          </div>
          <div>
            <p className="text-lg leading-9 text-slate-300">{brief.audience.value}</p>
            {brief.differentiators.length ? (
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {brief.differentiators.map((item) => (
                  <li key={item.value} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-slate-200">{item.value}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {services.length ? (
        <section id="servicos" className="scroll-mt-20 border-y border-white/10 bg-white/[0.025]">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Serviços</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">O que está disponível</h2>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {services.map((service, index) => (
                <article key={service.id} className="rounded-[1.75rem] border border-white/10 bg-[#0d0f15] p-7">
                  <span className="text-xs font-semibold text-slate-500">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="mt-5 text-2xl font-semibold">{service.name}</h3>
                  {service.summary ? <p className="mt-4 leading-7 text-slate-300">{service.summary}</p> : null}
                  {service.body.map((paragraph) => <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-400">{paragraph}</p>)}
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section id="contato" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Contato</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Fale com {brief.businessName.value}</h2>
        <div className="mt-9 grid gap-4 md:grid-cols-2">
          {contact.phone ? <a href={`tel:${contact.phone.value}`} className="flex items-center gap-4 rounded-2xl border border-white/10 p-5 hover:border-cyan-300/40"><Phone className="text-cyan-300" /><span>{contact.phone.value}</span></a> : null}
          {contact.whatsapp ? <a href={`https://wa.me/${contact.whatsapp.value.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-4 rounded-2xl border border-white/10 p-5 hover:border-cyan-300/40"><MessageCircle className="text-cyan-300" /><span>WhatsApp</span><ExternalLink size={14} /></a> : null}
          {contact.email ? <a href={`mailto:${contact.email.value}`} className="flex items-center gap-4 rounded-2xl border border-white/10 p-5 hover:border-cyan-300/40"><Mail className="text-cyan-300" /><span className="break-all">{contact.email.value}</span></a> : null}
          {contact.address ? <div className="flex items-start gap-4 rounded-2xl border border-white/10 p-5"><MapPin className="mt-1 shrink-0 text-cyan-300" /><span className="leading-7 text-slate-300">{addressText(contact.address.value)}</span></div> : null}
          {contact.socialLinks.map((social) => <a key={social.value.url} href={social.value.url} target="_blank" rel="noreferrer" className="flex items-center gap-4 rounded-2xl border border-white/10 p-5 hover:border-cyan-300/40"><ExternalLink className="text-cyan-300" /><span>{social.value.label ?? social.value.platform}</span></a>)}
        </div>
        {!contact.phone && !contact.whatsapp && !contact.email && !contact.address && contact.socialLinks.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-amber-200/15 bg-amber-100/[0.04] p-5 text-sm leading-7 text-amber-100/70">Nenhum canal de contato foi confirmado no briefing.</p>
        ) : null}
      </section>

      <footer className="border-t border-white/10 px-5 py-9 text-center text-xs leading-6 text-slate-500">
        Proposta visual baseada somente nas informações confirmadas no briefing. Revise o conteúdo antes da publicação definitiva.
      </footer>
    </main>
  );
}
