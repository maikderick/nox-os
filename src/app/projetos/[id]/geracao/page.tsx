import Link from "next/link";

import { GenerationControls } from "@/components/projetos/generation-controls";
import { requirePermission } from "@/lib/authz/dal";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import { INTEGRATION_MODE_LABELS } from "@/lib/integrations/modes";
import { getSiteProject } from "@/lib/site-factory/project-service";
import {
  hasInternalPreview,
  isSiteProjectState,
  statesWithTransitionTo,
} from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  EXECUTANDO: "Executando",
  CONCLUIDO: "Concluído",
  FALHOU: "Falhou",
  CANCELADO: "Cancelado",
};

export default async function GenerationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const [project, cursorMode, githubMode, vercelMode] = await Promise.all([
    getSiteProject(actor, id),
    getEffectiveMode(actor.organizationId, "cursor"),
    getEffectiveMode(actor.organizationId, "github"),
    getEffectiveMode(actor.organizationId, "vercel"),
  ]);

  const provisioned = Boolean(project.repository?.protectedAt && project.hostingProject?.linkedAt);
  const eligible =
    isSiteProjectState(project.status) &&
    statesWithTransitionTo("GERANDO").includes(project.status);
  const canRequestGeneration =
    actor.permissions.includes("generation:run") &&
    Boolean(project.currentBriefVersionId) &&
    cursorMode !== "DESLIGADO" &&
    eligible;
  const canPrepare =
    actor.permissions.includes("provisioning:run") &&
    githubMode !== "DESLIGADO" &&
    vercelMode !== "DESLIGADO";
  const previewReady = isSiteProjectState(project.status) && hasInternalPreview(project.status);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">Geração</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{project.name}</h1>
        <p className="mt-3 text-sm text-nox-muted">
          Cursor: {INTEGRATION_MODE_LABELS[cursorMode]} · GitHub: {INTEGRATION_MODE_LABELS[githubMode]}
          {" · "}Vercel: {INTEGRATION_MODE_LABELS[vercelMode]} · projeto: {project.status}
        </p>
      </section>

      {!provisioned ? (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5 text-sm text-amber-100/80">
          O repositório e a hospedagem ainda não foram preparados. O botão abaixo executará essas etapas automaticamente antes de gerar.
          <Link href={`/projetos/${project.id}/provisionamento`} className="ml-2 text-nox-cyan hover:underline">
            Abrir provisionamento
          </Link>
        </section>
      ) : null}
      {cursorMode === "DESLIGADO" ? (
        <section className="rounded-2xl border border-nox-border bg-nox-panel p-5 text-sm text-nox-muted">
          A integração Cursor está desligada.
          <Link href="/organizacao/integracoes" className="ml-2 text-nox-cyan hover:underline">Configurar</Link>
        </section>
      ) : null}
      {!provisioned && !canPrepare ? (
        <section className="rounded-2xl border border-nox-border bg-nox-panel p-5 text-sm text-nox-muted">
          Ative GitHub e Vercel em modo falso ou sandbox para preparar a prévia.
          <Link href="/organizacao/integracoes" className="ml-2 text-nox-cyan hover:underline">Configurar</Link>
        </section>
      ) : null}

      <section className="rounded-2xl border border-nox-border bg-nox-surface p-5">
        <h2 className="text-lg font-semibold text-white">Controle</h2>
        <p className="mt-2 mb-4 text-sm leading-6 text-nox-muted">
          O pedido é idempotente, entra na fila durável e segue pelo consumidor agendado. O botão de processamento antecipa o próximo ciclo.
        </p>
        <GenerationControls
          projectId={project.id}
          canGenerate={canRequestGeneration}
          canPrepare={canPrepare}
          needsProvisioning={!provisioned}
          canRunQueue={actor.permissions.includes("job:run")}
          isProcessing={project.status === "GERANDO"}
          publicHref={previewReady ? `/sites/${project.id}` : null}
        />
        {previewReady ? (
          <p className="mt-3 text-xs leading-5 text-nox-muted">
            O endereço acima não exige login. Para um cliente fora da sua rede, abra o NOX pelo domínio público antes de copiar.
            <Link href={`/projetos/${project.id}/preview`} className="ml-2 text-nox-cyan hover:underline">
              Revisar internamente
            </Link>
          </p>
        ) : null}
        {!eligible ? <p className="mt-3 text-xs text-nox-muted">O estado atual não aceita uma nova geração.</p> : null}
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white">Execuções</h2>
        {project.generationRuns.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-nox-border p-6 text-sm text-nox-muted">Nenhuma geração solicitada.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {project.generationRuns.map((run) => (
              <article key={run.id} className="rounded-2xl border border-nox-border bg-nox-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{STATUS_LABELS[run.status] ?? run.status}</p>
                    <p className="mt-1 text-xs text-nox-muted">
                      {run.createdAt.toLocaleString("pt-BR")} · disposição {run.startDisposition}
                    </p>
                  </div>
                  <span className="rounded-full border border-nox-border px-3 py-1 text-xs text-nox-muted">
                    crédito {run.reservation?.status ?? "não reservado"}
                  </span>
                </div>
                {run.jobs.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-xs">
                      <thead className="text-nox-muted"><tr><th className="pb-2">Etapa</th><th className="pb-2">Estado</th><th className="pb-2">Tentativas</th><th className="pb-2">Espera</th><th className="pb-2">Resgates</th></tr></thead>
                      <tbody className="divide-y divide-nox-border">
                        {run.jobs.map((job) => (
                          <tr key={job.id}>
                            <td className="py-2 text-white">{job.kind}</td><td className="py-2 text-nox-muted">{job.status}</td><td className="py-2 text-nox-muted">{job.attempts}/{job.maxAttempts}</td><td className="py-2 text-nox-muted">{job.pollCount}</td><td className="py-2 text-nox-muted">{job.leaseRecoveryCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
