import type { Metadata } from "next";
import Link from "next/link";

import { CATEGORY_GROUPS } from "@/lib/categories";
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

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
  const previewReady = hasInternalPreview(state);

  const currentBrief = project.briefVersions.find(
    (version) => version.id === project.currentBriefVersionId,
  );
  const brief = currentBrief ? parseSiteBrief(currentBrief.contentJson) : null;

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
      <section className="rounded-2xl border border-nox-border bg-nox-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-nox-muted">{project.client.name}</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{project.name}</h1>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[state]}`}>
            {SITE_PROJECT_STATE_LABELS[state]}
          </span>
        </div>
        {currentBrief && (
          <p className="mt-4 text-sm text-nox-muted">Briefing v{currentBrief.version}</p>
        )}
      </section>

      {direction && composition ? (
        <>
          <section className="rounded-2xl border border-nox-border bg-nox-surface p-6">
            <h2 className="text-lg font-semibold text-white">Direção de arte resolvida</h2>
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

          <section className="rounded-2xl border border-nox-border bg-nox-surface p-6">
            <h2 className="text-lg font-semibold text-white">Composição do site</h2>
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
          <Link
            href={`/projetos/${project.id}/geracao`}
            className="mt-3 inline-block text-sm text-nox-cyan hover:underline"
          >
            Ir para o briefing
          </Link>
        </section>
      )}

      <section className="rounded-2xl border border-nox-border bg-nox-surface p-6">
        <h2 className="text-lg font-semibold text-white">Etapas</h2>
        <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-6">
          <Link href={`/projetos/${project.id}/geracao`} className="text-nox-cyan hover:underline">
            Geração
          </Link>
          <Link href={`/projetos/${project.id}/provisionamento`} className="text-nox-cyan hover:underline">
            Provisionamento
          </Link>
          {previewReady ? (
            <Link href={`/projetos/${project.id}/preview`} className="text-nox-cyan hover:underline">
              Prévia interna
            </Link>
          ) : (
            <span className="text-nox-muted">Prévia interna indisponível nesta etapa</span>
          )}
          {previewReady && (
            <Link href={`/sites/${project.id}`} className="text-nox-cyan hover:underline">
              Ver site
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
