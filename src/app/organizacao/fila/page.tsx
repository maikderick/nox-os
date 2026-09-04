import { QueueJobActions, QueueRunner } from "@/components/organizacao/queue-actions";
import { requirePermission } from "@/lib/authz/dal";
import { listOrganizationJobs } from "@/lib/jobs/conciliation";
import { requireUser } from "@/lib/session";

const STATUS_STYLES: Record<string, string> = {
  PENDENTE: "border-cyan-400/30 text-cyan-200",
  EM_EXECUCAO: "border-violet-400/30 text-violet-200",
  PAUSADO: "border-amber-400/30 text-amber-200",
  CONCILIACAO: "border-orange-400/40 text-orange-200",
  CONCLUIDO: "border-emerald-400/30 text-emerald-200",
  FALHOU: "border-red-400/30 text-red-200",
  CARTA_MORTA: "border-red-400/50 text-red-100",
};

export default async function QueuePage() {
  await requireUser();
  const actor = await requirePermission("job:read");
  const jobs = await listOrganizationJobs(actor);
  const canRun = actor.permissions.includes("job:run");
  const attention = jobs.filter((job) => ["CONCILIACAO", "CARTA_MORTA"].includes(job.status)).length;
  const active = jobs.filter((job) => ["PENDENTE", "EM_EXECUCAO", "PAUSADO"].includes(job.status)).length;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">Operação</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Fila durável</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-nox-muted">Tentativas medem falhas; espera mede polling; resgates medem consumidores interrompidos. Eles permanecem separados para não transformar espera saudável em erro.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Exibidos" value={jobs.length} />
        <Metric label="Ativos" value={active} />
        <Metric label="Pedem atenção" value={attention} />
      </section>

      {canRun ? <QueueRunner /> : <p className="text-sm text-nox-muted">Você pode acompanhar a fila; executar e conciliar exige job:run.</p>}

      <section className="space-y-4">
        {jobs.length === 0 ? <p className="rounded-2xl border border-dashed border-nox-border p-8 text-center text-sm text-nox-muted">A fila está vazia.</p> : jobs.map((job) => (
          <article key={job.id} className="rounded-2xl border border-nox-border bg-nox-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="font-medium text-white">{job.kind}</h2><p className="mt-1 text-xs text-nox-muted">{job.siteProject?.name ?? "Sem projeto"} · atualizado em {job.updatedAt.toLocaleString("pt-BR")}</p></div>
              <span className={`rounded-full border px-3 py-1 text-xs ${STATUS_STYLES[job.status] ?? "border-nox-border text-nox-muted"}`}>{job.status}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-nox-border pt-4 text-xs sm:grid-cols-5">
              <Cell label="Tentativas" value={`${job.attempts}/${job.maxAttempts}`} />
              <Cell label="Esperas" value={job.pollCount} />
              <Cell label="Resgates" value={job.leaseRecoveryCount} />
              <Cell label="Reserva" value={job.generationRun?.reservation?.status ?? "—"} />
              <Cell label="Disposição" value={job.generationRun?.startDisposition ?? "—"} />
            </dl>
            {job.lastError ? <p className="mt-4 text-sm leading-6 text-nox-muted">{job.lastError}</p> : null}
            {canRun ? <QueueJobActions jobId={job.id} status={job.status} kind={job.kind} /> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-nox-border bg-nox-surface p-5"><p className="text-sm text-nox-muted">{label}</p><p className="mt-2 text-3xl font-semibold text-white">{value}</p></div>;
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-nox-muted">{label}</dt><dd className="mt-1 text-white">{value}</dd></div>;
}
