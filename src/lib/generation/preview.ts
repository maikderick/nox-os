import "server-only";

import { prisma } from "@/lib/db";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import type { JobOutcome } from "@/lib/jobs/handlers";
import type { HostingProvider } from "@/lib/providers/ports";
import { getHostingProvider } from "@/lib/providers/registry";
import { REQUIRED_CHECK } from "@/lib/provisioning/naming";
import { chooseDeployment } from "@/lib/provisioning/step-preview";

import { settleGeneration } from "./observe";
import { GenerationRefusal } from "./reasons";

/**
 * The preview deployment, observed and written down.
 *
 * The sibling of `checks.ts`, and deliberately its twin: it observes, it
 * persists one fact, and it lets the barrier decide. Neither knows about the
 * other; what makes the last one close the generation is the conditional update
 * inside `settleGeneration`, not any ordering between them.
 */

export const PREVIEW_POLL_DELAY_SECONDS = 30;

/** The platform's vocabulary to the closed set the column holds. */
const STATUSES: Record<string, string> = {
  QUEUED: "PENDENTE",
  INITIALIZING: "EM_ANDAMENTO",
  BUILDING: "EM_ANDAMENTO",
  READY: "PRONTO",
  ERROR: "FALHOU",
  CANCELED: "CANCELADO",
  CANCELLED: "CANCELADO",
};

/**
 * A word we do not recognise reads as `PENDENTE`, for the same reason as in
 * `checks.ts`: failing a generation over a status nobody understood would be a
 * decision taken from ignorance, and the deadline already turns persistent
 * ignorance into conciliation.
 */
export function mapDeploymentStatus(raw: string): string {
  return STATUSES[raw.trim().toUpperCase()] ?? "PENDENTE";
}

export type PollPreviewParams = {
  generationRunId: string;
  provider?: HostingProvider;
};

export async function pollPreview(params: PollPreviewParams): Promise<JobOutcome> {
  const run = await prisma.generationRun.findUnique({
    where: { id: params.generationRunId },
    select: {
      siteProjectId: true,
      siteProject: {
        select: {
          organizationId: true,
          hostingProject: { select: { name: true, externalId: true, url: true } },
          repository: { select: { owner: true, name: true } },
        },
      },
      revision: { select: { id: true, commitSha: true } },
    },
  });
  if (!run) throw new GenerationRefusal("RUN_INEXISTENTE");

  const revision = run.revision;
  if (!revision?.commitSha) throw new GenerationRefusal("REVISAO_AUSENTE");

  const hosting = run.siteProject.hostingProject;
  if (!hosting?.externalId) throw new GenerationRefusal("HOSPEDAGEM_NAO_PROVISIONADA");

  const mode = await getEffectiveMode(run.siteProject.organizationId, "vercel");
  const provider = params.provider ?? getHostingProvider(mode);

  // Scoped to this project's own hosting project and this revision's own
  // commit. A poller that listed every deployment and picked by commit alone
  // could pick up another project's build of a commit with the same sha —
  // unlikely, and exactly the kind of unlikely that is impossible to debug.
  const deployments = await provider.listDeployments({
    project: {
      externalId: hosting.externalId,
      name: hosting.name,
      url: hosting.url,
      linkedRepository: run.siteProject.repository
        ? { owner: run.siteProject.repository.owner, name: run.siteProject.repository.name }
        : null,
    },
    commitSha: revision.commitSha,
  });

  const chosen = chooseDeployment(deployments);
  const status = chosen ? mapDeploymentStatus(chosen.state) : null;

  if (status === null || status === "PENDENTE" || status === "EM_ANDAMENTO") {
    // The platform has not finished building. Waiting, not failing: no attempt
    // is consumed and no backoff applies.
    return { type: "aguardar", delaySeconds: PREVIEW_POLL_DELAY_SECONDS };
  }

  await prisma.$transaction(async (tx) => {
    // Idempotent by the deployment this run already recorded, if any. Keying on
    // the revision and the provider's own id means a repeated poll updates the
    // row it wrote last time instead of stacking a build per visit.
    const existing = await tx.deployment.findFirst({
      where: {
        siteRevisionId: revision.id,
        environment: "PREVIA",
        providerDeploymentId: chosen!.externalId,
      },
      select: { id: true },
    });

    const data = {
      status,
      url: chosen!.url,
      commitSha: chosen!.commitSha ?? revision.commitSha,
      finishedAt: new Date(),
    };

    if (existing) {
      await tx.deployment.update({ where: { id: existing.id }, data });
    } else {
      await tx.deployment.create({
        data: {
          siteProjectId: run.siteProjectId,
          siteRevisionId: revision.id,
          environment: "PREVIA",
          provider: "vercel",
          providerDeploymentId: chosen!.externalId,
          ...data,
        },
      });
    }

    // Same transaction as the fact, so the barrier can never read something a
    // rollback then removed.
    await settleGeneration(tx, {
      generationRunId: params.generationRunId,
      requiredCheck: REQUIRED_CHECK,
    });
  });

  return { type: "concluido" };
}
