import Link from "next/link";
import { ExternalLink, TriangleAlert } from "lucide-react";

import { requirePermission } from "@/lib/authz/dal";
import { ProvisioningSteps } from "@/components/projetos/provisioning-steps";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import { INTEGRATION_MODE_LABELS } from "@/lib/integrations/modes";
import {
  PROVISIONING_STATUS_LABELS,
  getProvisioning,
  type ProvisioningStatus,
} from "@/lib/provisioning/state";
import { requireUser } from "@/lib/session";

export default async function ProvisioningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const actor = await requirePermission("provisioning:read");
  const { id } = await params;

  const { project, provisioning, repository, hostingProject } = await getProvisioning(actor, id);
  const [githubMode, vercelMode] = await Promise.all([
    getEffectiveMode(actor.organizationId, "github"),
    getEffectiveMode(actor.organizationId, "vercel"),
  ]);

  const canRun = actor.permissions.includes("provisioning:run");
  const status = (provisioning?.status ?? "PENDENTE") as ProvisioningStatus;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">
          Provisionamento
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{project.name}</h1>
        <p className="mt-3 text-sm text-nox-muted">
          Cliente {project.client.name} · Estado {PROVISIONING_STATUS_LABELS[status]}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-nox-border px-3 py-1 text-nox-muted">
            GitHub: {INTEGRATION_MODE_LABELS[githubMode]}
          </span>
          <span className="rounded-full border border-nox-border px-3 py-1 text-nox-muted">
            Vercel: {INTEGRATION_MODE_LABELS[vercelMode]}
          </span>
          <Link
            href="/organizacao/integracoes"
            className="rounded-full border border-nox-border px-3 py-1 text-nox-cyan hover:text-white"
          >
            Alterar integrações
          </Link>
        </div>
      </section>

      {provisioning?.lastError ? (
        <section className="rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-red-200">
            <TriangleAlert size={16} aria-hidden="true" />
            Última falha, em {provisioning.lastStep ?? "etapa desconhecida"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-red-100/80">{provisioning.lastError}</p>
        </section>
      ) : null}

      <ProvisioningSteps
        projectId={project.id}
        canRun={canRun}
        state={{
          status,
          lastStep: provisioning?.lastStep ?? null,
          commitSha: provisioning?.commitSha ?? null,
          contentSha256: provisioning?.contentSha256 ?? null,
          previewUrl: provisioning?.previewUrl ?? null,
          previewCheckedAt: provisioning?.previewCheckedAt?.toISOString() ?? null,
          repositoryUrl: repository?.url ?? null,
          repositoryName: repository ? `${repository.owner}/${repository.name}` : null,
          hostingName: hostingProject?.name ?? null,
          hostingUrl: hostingProject?.url ?? null,
        }}
      />

      {repository?.url || hostingProject?.url || provisioning?.previewUrl ? (
        <section className="rounded-2xl border border-nox-border bg-nox-panel p-5">
          <h2 className="text-sm font-semibold text-white">Onde as coisas ficaram</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {repository?.url ? (
              <li>
                <a
                  href={repository.url}
                  className="inline-flex items-center gap-1 text-nox-cyan hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Repositório <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ) : null}
            {hostingProject?.url ? (
              <li>
                <a
                  href={hostingProject.url}
                  className="inline-flex items-center gap-1 text-nox-cyan hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Projeto de hospedagem <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ) : null}
            {provisioning?.previewUrl ? (
              <li>
                <a
                  href={provisioning.previewUrl}
                  className="inline-flex items-center gap-1 text-nox-cyan hover:underline"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Prévia <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
