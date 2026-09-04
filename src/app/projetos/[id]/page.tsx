import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, FileText, MapPin, Phone } from "lucide-react";

import { CATEGORY_GROUPS } from "@/lib/categories";
import { GenerateSiteButton, SendToReviewButton } from "@/components/projetos/generate-site-button";
import { requirePermission } from "@/lib/authz/dal";
import { resolveArtDirection, type Palette } from "@/lib/design/art-direction";
import { BLOCK_LABELS, resolveComposition } from "@/lib/design/blocks";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import {
  hasInternalPreview, isSiteProjectState, SITE_PROJECT_STATE_LABELS,
} from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Projeto",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ id: string }> };

// Copied from `src/app/projetos/page.tsx` rather than imported: the listing
// keeps its own presentation details untouched by this task, and the record
// is small enough that a shared module would cost more indirection than it
// saves. Keep the two in sync by hand if a status colour changes.
const STATUS_STYLES: Record<string, string> = {
  RASCUNHO: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  BRIEFING_PRONTO: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  GERANDO: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  PREVIA_PRONTA: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  EM_REVISAO: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  APROVADO: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  PUBLICANDO: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200",
  PUBLICADO: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  FALHOU: "border-red-400/30 bg-red-400/10 text-red-200",
};

const PALETTE_ROLES: { key: keyof Palette; label: string }[] = [
  { key: "surface", label: "Superfície" },
  { key: "surfaceAlt", label: "Superfície alternativa" },
  { key: "ink", label: "Tinta" },
  { key: "inkMuted", label: "Tinta suave" },
  { key: "line", label: "Linha" },
  { key: "accent", label: "Destaque" },
];

export default async function ProjectPage({ params }: PageProps) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  const canWrite = actor.permissions.includes("project:write");
  const businessId = project.client.businessId;

  const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
  const previewReady = hasInternalPreview(state);

  const currentBrief = project.briefVersions.find(
    (version) => version.id === project.currentBriefVersionId,
  );
  const brief = currentBrief ? parseSiteBrief(currentBrief.contentJson) : null;
  const services = brief?.schemaVersion === 2 ? brief.services : [];
  const contact = brief?.schemaVersion === 2 ? brief.publicContact : null;
  const address = contact?.address?.value ?? null;

  // The direction is shown before anyone generates, because the sector is free
  // text and the match can be wrong. Seeing it here is how an operator catches
  // a barbershop that resolved as a gym.
  const direction = brief
    ? resolveArtDirection({ sector: brief.sector.value, seed: project.id })
    : null;
  const composition = brief ? resolveComposition(brief) : null;
  const categoryLabel = direction
    ? CATEGORY_GROUPS.find((group) => group.id === direction.categoryId)?.label
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/projetos"
            className="inline-flex items-center gap-1.5 text-xs text-nox-muted hover:text-white"
          >
            <ArrowLeft size={13} aria-hidden="true" /> Projetos
          </Link>
          <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-white">
            {project.name}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-nox-muted">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} aria-hidden="true" /> {project.client.name}
            </span>
            {project.sector ? <span>{project.sector}</span> : null}
            {currentBrief ? <span>Briefing v{currentBrief.version}</span> : null}
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[state]}`}>
              {SITE_PROJECT_STATE_LABELS[state]}
            </span>
          </p>
        </div>
        {businessId ? (
          <Link href={`/leads/${businessId}`} className="nox-btn-secondary">
            Ficha do lead
          </Link>
        ) : null}
      </div>

      {/* The one thing to do next, before anything explanatory. Which action it
          is comes from the state, so the page never offers a button the state
          machine would refuse. */}
      <section className="nox-card p-6" aria-label="Próximo passo">
        {brief && state === "BRIEFING_PRONTO" ? (
          <>
            <h2 className="text-xl font-semibold text-white">Gerar o site</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-nox-muted">
              Gera o site a partir das informações confirmadas. Leva alguns segundos.
            </p>
            {canWrite ? (
              <div className="mt-5">
                <GenerateSiteButton projectId={project.id} />
              </div>
            ) : (
              <p className="mt-5 text-sm text-nox-muted">
                Seu papel não permite gerar o site. Peça a um operador da organização.
              </p>
            )}
          </>
        ) : previewReady ? (
          <>
            <h2 className="text-xl font-semibold text-white">Site gerado</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-nox-muted">
              O endereço de apresentação abre sem login e sempre mostra a versão atual do
              briefing confirmado.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={`/sites/${project.id}`} className="nox-btn-primary px-6 py-3 text-base">
                Ver site
              </Link>
              <Link href={`/projetos/${project.id}/preview`} className="nox-btn-secondary">
                Prévia interna
              </Link>
              {canWrite && state === "PREVIA_PRONTA" ? (
                <SendToReviewButton projectId={project.id} />
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-white">Confirmar o briefing</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-nox-muted">
              O site é calculado a partir dos fatos confirmados. Sem briefing confirmado não há
              o que gerar.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/projetos/novo" className="nox-btn-primary px-6 py-3 text-base">
                Concluir briefing
              </Link>
              {brief ? (
                <Link href={`/projetos/${project.id}/preview`} className="nox-btn-secondary">
                  Prévia interna
                </Link>
              ) : null}
            </div>
          </>
        )}

        {!previewReady ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-nox-border pt-4 text-sm">
            {brief && state === "BRIEFING_PRONTO" ? (
              <Link href={`/projetos/${project.id}/preview`} className="text-nox-cyan hover:underline">
                Prévia interna
              </Link>
            ) : null}
            <span className="text-nox-muted">
              Site público: disponível depois de gerar o site
            </span>
          </div>
        ) : null}
      </section>

      {direction && composition ? (
        <>
          <section className="nox-card p-6" aria-label="Direção de arte">
            <h2 className="text-base font-semibold text-white">Direção de arte resolvida</h2>
            <p className="mt-3 text-xl leading-snug text-white">{direction.anchor}</p>
            <p className="mt-2 text-sm text-nox-muted">
              Categoria: {categoryLabel ?? direction.categoryId} ({direction.categoryId})
            </p>

            <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {PALETTE_ROLES.map(({ key, label }) => {
                const hex = direction.palette[key];
                return (
                  <div key={key} className="flex flex-col items-center gap-2 text-center">
                    <span
                      className="h-12 w-12 rounded-lg border border-nox-border"
                      style={{ background: hex }}
                      aria-hidden
                    />
                    <span className="text-xs text-nox-muted">{label}</span>
                    <span className="text-xs text-white">{hex}</span>
                  </div>
                );
              })}
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-nox-muted">Tipografia de destaque</dt>
                <dd className="mt-1 text-white">{direction.type.display}</dd>
              </div>
              <div>
                <dt className="text-nox-muted">Tipografia de texto</dt>
                <dd className="mt-1 text-white">{direction.type.body}</dd>
              </div>
              <div>
                <dt className="text-nox-muted">Raio</dt>
                <dd className="mt-1 text-white">{direction.radius}</dd>
              </div>
              <div>
                <dt className="text-nox-muted">Compasso</dt>
                <dd className="mt-1 text-white">{direction.rhythm}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-nox-muted">Recurso estrutural: {direction.device}</p>
          </section>

          <section className="nox-card p-6" aria-label="Composição do site">
            <h2 className="text-base font-semibold text-white">Composição do site</h2>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {composition.blocks.map((block) => (
                <li key={block} className="rounded-lg border border-nox-border px-3 py-1.5 text-white">
                  {BLOCK_LABELS[block]}
                </li>
              ))}
            </ul>

            {composition.unmapped.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                <p className="text-sm font-medium text-amber-200">
                  Seções pedidas que não serão construídas
                </p>
                <p className="mt-1 text-sm text-amber-100">
                  Nenhum fato confirmado no briefing sustenta estas seções, então elas não vão
                  aparecer no site gerado.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100">
                  {composition.unmapped.map((section) => (
                    <li key={section}>{section}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed border-nox-border bg-nox-surface/70 p-6">
          <p className="text-sm text-nox-muted">
            Este projeto ainda não tem um briefing confirmado, então a direção de arte e a
            composição do site ainda não podem ser resolvidas.
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="nox-card p-6" aria-label="Briefing">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <FileText size={16} className="text-nox-cyan" aria-hidden="true" /> Briefing confirmado
            </h2>
            <span className="font-mono text-xs text-nox-muted">v{currentBrief?.version ?? "—"}</span>
          </div>
          {brief ? (
            <dl className="mt-4 space-y-4 text-sm">
              <Item label="Negócio" value={brief.businessName.value} />
              <Item label="Setor" value={brief.sector.value} />
              {brief.city?.value ? <Item label="Cidade" value={brief.city.value} /> : null}
              <Item label="Objetivo" value={brief.objective.value} />
              <Item label="Posicionamento" value={brief.positioning.value} />
              <Item label="Público" value={brief.audience.value} />
              <Item label="Direção visual" value={brief.visualDirection.value} />
              {brief.differentiators.length ? (
                <div>
                  <dt className="text-nox-muted">Diferenciais</dt>
                  <dd className="mt-1">
                    <ul className="list-disc space-y-1 pl-5 leading-6 text-white/90">
                      {brief.differentiators.map((fact) => (
                        <li key={fact.value}>{fact.value}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-nox-muted">
              Este projeto ainda não tem briefing confirmado.
            </p>
          )}
        </section>

        <div className="space-y-4">
          <section className="nox-card p-6" aria-label="Serviços">
            <h2 className="text-base font-semibold text-white">
              Serviços <span className="font-mono text-xs text-nox-muted">({services.length})</span>
            </h2>
            {services.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {services.map((service) => (
                  <li key={service.id} className="rounded-xl border border-nox-border bg-nox-bg/40 px-3 py-2">
                    <p className="font-medium text-white">{service.name.value}</p>
                    <p className="mt-0.5 text-xs text-nox-muted">{service.summary.value}</p>
                    {service.price ? (
                      <p className="mt-0.5 text-xs text-white/90">{service.price.value}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-nox-muted">
                Nenhum serviço confirmado. O site sai sem a seção de serviços.
              </p>
            )}
          </section>

          <section className="nox-card p-6" aria-label="Contato público">
            <h2 className="text-base font-semibold text-white">Contato público</h2>
            <ul className="mt-3 space-y-2 text-sm text-nox-muted">
              <li className="flex items-center gap-2">
                <Phone size={14} className="text-nox-cyan" aria-hidden="true" />
                {contact?.whatsapp?.value
                  ? `WhatsApp ${contact.whatsapp.value}`
                  : contact?.phone?.value
                    ? `Telefone ${contact.phone.value}`
                    : "Sem telefone confirmado"}
              </li>
              <li className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 text-nox-cyan" aria-hidden="true" />
                {address
                  ? [address.street, address.number, address.neighborhood, address.city, address.state]
                      .filter(Boolean)
                      .join(", ")
                  : "Sem endereço confirmado"}
              </li>
            </ul>
          </section>
        </div>
      </div>

      {/* The agent pipeline, kept as what it is: a later step that builds the
          real repository. The site the client sees does not wait for it. */}
      <section className="nox-card p-6" aria-label="Construção do repositório">
        <h2 className="text-base font-semibold text-white">
          Construção do repositório (opcional)
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-nox-muted">
          Etapa seguinte, conduzida por agente, que cria o repositório e a hospedagem reais. O
          site de apresentação não depende dela.
        </p>
        <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-6">
          <Link href={`/projetos/${project.id}/geracao`} className="text-nox-cyan hover:underline">
            Geração
          </Link>
          <Link href={`/projetos/${project.id}/provisionamento`} className="text-nox-cyan hover:underline">
            Provisionamento
          </Link>
        </div>
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-nox-muted">{label}</dt>
      <dd className="mt-1 leading-6 text-white/90">{value}</dd>
    </div>
  );
}
