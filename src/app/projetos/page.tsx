import Link from "next/link";
import { Layers3, Plus, Rocket, ShieldCheck } from "lucide-react";

import { requirePermission } from "@/lib/authz/dal";
import { listSiteProjects } from "@/lib/site-factory/project-service";
import {
  hasInternalPreview,
  isSiteProjectState,
  SITE_PROJECT_STATE_LABELS,
} from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

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

export default async function ProjectsPage() {
  await requireUser();
  const actor = await requirePermission("project:read");
  const projects = await listSiteProjects(actor);

  const published = projects.filter((project) => project.status === "PUBLICADO").length;
  const active = projects.filter((project) => !["RASCUNHO", "PUBLICADO", "FALHOU"].includes(project.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="nox-eyebrow">Fábrica de sites</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Projetos</h1>
          <p className="mt-1.5 max-w-xl text-sm text-nox-muted">
            Da oportunidade ao site publicado: briefing confirmado, revisões imutáveis e aprovação
            separada da execução.
          </p>
        </div>
        <Link href="/projetos/novo" className="nox-btn-primary">
          <Plus size={16} aria-hidden="true" /> Novo projeto
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo da fábrica">
        <Metric icon={<Layers3 size={16} />} label="Projetos" value={projects.length} />
        <Metric icon={<Rocket size={16} />} label="Em andamento" value={active} />
        <Metric icon={<ShieldCheck size={16} />} label="Publicados" value={published} accent />
      </section>

      <section>
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-nox-border bg-nox-surface/60 p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-nox-cyan/10 text-nox-cyan">
              <Layers3 size={22} aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-semibold text-white">Nenhum projeto ainda</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-nox-muted">
              Escolha um negócio da prospecção, confirme o briefing e crie o primeiro projeto.
            </p>
            <Link href="/projetos/novo" className="nox-btn-primary mt-5">
              Criar primeiro projeto
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
              const previewReady = hasInternalPreview(state);
              // A generated site opens; anything else sends the operator to the
              // project page, which is where the action for its state lives.
              const actionHref = previewReady
                ? `/sites/${project.id}`
                : `/projetos/${project.id}`;
              const actionLabel = previewReady
                ? "Ver site"
                : state === "BRIEFING_PRONTO"
                  ? "Gerar site"
                  : state === "GERANDO"
                    ? "Acompanhar construção"
                    : "Abrir projeto";
              return (
                <article key={project.id} className="nox-card p-5 transition hover:border-nox-border-strong">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-nox-muted">{project.client.name}</p>
                      <h3 className="mt-1.5 truncate text-lg font-semibold text-white">
                        <Link href={`/projetos/${project.id}`} className="hover:text-nox-cyan">
                          {project.name}
                        </Link>
                      </h3>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[state]}`}>
                      {SITE_PROJECT_STATE_LABELS[state]}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-nox-border pt-4 text-xs">
                    <div>
                      <dt className="text-nox-muted">Briefing</dt>
                      <dd className="mt-1 font-mono text-white">v{project.currentBriefVersion?.version ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-nox-muted">Revisões</dt>
                      <dd className="mt-1 font-mono text-white">{project._count.revisions}</dd>
                    </div>
                    <div>
                      <dt className="text-nox-muted">Deploys</dt>
                      <dd className="mt-1 font-mono text-white">{project._count.deployments}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-nox-border pt-4 text-sm">
                    <Link
                      href={`/projetos/${project.id}/provisionamento`}
                      className="text-nox-muted hover:text-white"
                    >
                      Provisionamento
                    </Link>
                    <Link href={actionHref} className="text-nox-cyan hover:underline">
                      {actionLabel}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`nox-kpi ${accent ? "border-nox-cyan/30 bg-nox-cyan/5" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="nox-kpi-label">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ? "bg-nox-cyan text-nox-bg" : "bg-nox-panel text-nox-cyan"}`}>
          {icon}
        </span>
      </div>
      <p className="nox-kpi-value">{value}</p>
    </div>
  );
}
