import Link from "next/link";
import { ArrowRight, Layers3, Plus, Rocket, ShieldCheck } from "lucide-react";

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
    <div className="space-y-8">
      <section className="rounded-3xl border border-nox-border bg-nox-surface p-6 sm:p-8">
        <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">Operação de sites</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Da oportunidade ao site publicado, com controle em cada etapa.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-nox-muted sm:text-base">
              Briefings baseados em fatos, revisões imutáveis e aprovação separada da execução.
            </p>
          </div>
          <Link
            href="/projetos/novo"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-nox-bg transition hover:bg-cyan-100"
          >
            <Plus size={17} /> Novo projeto
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Resumo da fábrica">
        <Metric icon={<Layers3 size={18} />} label="Projetos" value={projects.length} />
        <Metric icon={<Rocket size={18} />} label="Em andamento" value={active} />
        <Metric icon={<ShieldCheck size={18} />} label="Publicados" value={published} />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Projetos</h2>
            <p className="text-sm text-nox-muted">Acompanhe o estado e a versão atual de cada site.</p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-nox-border bg-nox-surface/70 p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-nox-purple/15 text-nox-purple">
              <Layers3 size={22} />
            </div>
            <h3 className="mt-4 font-semibold text-white">A fábrica está pronta</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-nox-muted">
              Selecione um lead, confirme o briefing e crie o primeiro projeto sem copiar dados sensíveis.
            </p>
            <Link href="/projetos/novo" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-nox-cyan hover:underline">
              Criar primeiro projeto <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const state = isSiteProjectState(project.status) ? project.status : "RASCUNHO";
              const previewReady = hasInternalPreview(state);
              const provisioned = Boolean(
                project.repository?.protectedAt && project.hostingProject?.linkedAt,
              );
              const actionHref = previewReady
                ? `/sites/${project.id}`
                : `/projetos/${project.id}/geracao`;
              const actionLabel = previewReady
                ? "Ver site"
                : state === "BRIEFING_PRONTO" && !provisioned
                  ? "Preparar e gerar"
                  : state === "GERANDO"
                    ? "Acompanhar geração"
                    : "Abrir geração";
              return (
                <article key={project.id} className="group rounded-2xl border border-nox-border bg-nox-surface p-5 transition hover:-translate-y-0.5 hover:border-nox-purple/70">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-nox-muted">{project.client.name}</p>
                      <h3 className="mt-2 text-lg font-semibold text-white">
                        <Link href={`/projetos/${project.id}`} className="hover:underline">{project.name}</Link>
                      </h3>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[state]}`}>
                      {SITE_PROJECT_STATE_LABELS[state]}
                    </span>
                  </div>
                  <dl className="mt-6 grid grid-cols-3 gap-2 border-t border-nox-border pt-4 text-xs">
                    <div><dt className="text-nox-muted">Briefing</dt><dd className="mt-1 text-white">v{project.currentBriefVersion?.version ?? "—"}</dd></div>
                    <div><dt className="text-nox-muted">Revisões</dt><dd className="mt-1 text-white">{project._count.revisions}</dd></div>
                    <div><dt className="text-nox-muted">Deploys</dt><dd className="mt-1 text-white">{project._count.deployments}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-nox-border pt-4 text-sm">
                    <Link href={`/projetos/${project.id}/provisionamento`} className="text-nox-muted hover:text-white">Provisionamento</Link>
                    <Link
                      href={actionHref}
                      className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 font-semibold text-nox-bg transition hover:bg-cyan-100"
                    >
                      {actionLabel} <ArrowRight size={14} />
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

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-nox-border bg-nox-surface p-5">
      <div className="flex items-center gap-2 text-nox-muted">{icon}<span className="text-sm">{label}</span></div>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
