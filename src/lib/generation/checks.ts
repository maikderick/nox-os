import "server-only";

import { prisma } from "@/lib/db";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import type { JobOutcome } from "@/lib/jobs/handlers";
import type { GitRepositoryProvider } from "@/lib/providers/ports";
import { getGitRepositoryProvider } from "@/lib/providers/registry";
import { REQUIRED_CHECK } from "@/lib/provisioning/naming";

import { settleGeneration } from "./observe";
import { GenerationRefusal } from "./reasons";

/**
 * The required check, observed and written down.
 *
 * The observer's whole job is to turn "what does the host say right now" into a
 * row, and then let the barrier decide. It decides nothing itself, which is why
 * it can run in any order relative to its sibling and as many times as the
 * queue wants.
 *
 * **Waiting is not failing.** A check that has not reported yet returns
 * `aguardar`: it counts `pollCount`, honours `pollDeadlineAt`, consumes no
 * attempt and applies no backoff. Running out of the thirty-minute deadline is
 * `CONCILIACAO`, which the queue applies on the caller's behalf — a check that
 * never appeared is not a check that failed.
 */

export const CHECK_POLL_DELAY_SECONDS = 30;

/** GitHub's vocabulary to the closed set the column holds. */
const CONCLUSIONS: Record<string, string> = {
  queued: "PENDENTE",
  pending: "PENDENTE",
  waiting: "PENDENTE",
  requested: "PENDENTE",
  in_progress: "EM_EXECUCAO",
  success: "SUCESSO",
  neutral: "SUCESSO",
  skipped: "SUCESSO",
  failure: "FALHA",
  timed_out: "FALHA",
  action_required: "FALHA",
  startup_failure: "FALHA",
  cancelled: "FALHA",
  stale: "FALHA",
};

/**
 * A word we do not recognise reads as `PENDENTE`.
 *
 * Never as `SUCESSO`, obviously — but also never as `FALHA`. Failing a
 * generation because the host invented a new status word would be this
 * application deciding something it did not understand. `PENDENTE` costs
 * another poll, and the deadline turns persistent incomprehension into
 * conciliation, which is where a human belongs.
 */
export function mapCheckConclusion(raw: string): string {
  return CONCLUSIONS[raw.trim().toLowerCase()] ?? "PENDENTE";
}

export type PollChecksParams = {
  generationRunId: string;
  provider?: GitRepositoryProvider;
};

export async function pollChecks(params: PollChecksParams): Promise<JobOutcome> {
  const run = await prisma.generationRun.findUnique({
    where: { id: params.generationRunId },
    select: {
      siteProjectId: true,
      siteProject: {
        select: {
          organizationId: true,
          repository: {
            select: { owner: true, name: true, externalId: true, url: true, defaultBranch: true },
          },
        },
      },
      revision: { select: { id: true, commitSha: true } },
    },
  });
  if (!run) throw new GenerationRefusal("RUN_INEXISTENTE");

  const revision = run.revision;
  if (!revision?.commitSha) throw new GenerationRefusal("REVISAO_AUSENTE");

  const repository = run.siteProject.repository;
  if (!repository) throw new GenerationRefusal("REPOSITORIO_NAO_PROVISIONADO");

  const mode = await getEffectiveMode(run.siteProject.organizationId, "github");
  const provider = params.provider ?? getGitRepositoryProvider(mode);

  const checks = await provider.listChecks({
    repo: {
      owner: repository.owner,
      name: repository.name,
      externalId: repository.externalId,
      url: repository.url,
      defaultBranch: repository.defaultBranch,
      templateRepository: null,
    },
    commitSha: revision.commitSha,
  });

  // The name comes from `REQUIRED_CHECK` — the same constant the branch
  // protection was built from. A green run of some other check is not the fact
  // anyone is waiting for.
  const required = checks.find((check) => check.name === REQUIRED_CHECK);
  const conclusion = required ? mapCheckConclusion(required.status) : null;

  if (conclusion === null || conclusion === "PENDENTE" || conclusion === "EM_EXECUCAO") {
    // Nothing is written for a check that has not concluded. A `PENDENTE` row
    // would be a fact about nothing, and the barrier would have to learn to
    // ignore it — one more state to get wrong.
    return { type: "aguardar", delaySeconds: CHECK_POLL_DELAY_SECONDS };
  }

  await prisma.$transaction(async (tx) => {
    // Idempotent by `@@unique([siteRevisionId, name])`: running twice updates
    // the same row rather than recording the same observation twice.
    await tx.generationCheck.upsert({
      where: {
        siteRevisionId_name: { siteRevisionId: revision.id, name: REQUIRED_CHECK },
      },
      create: {
        siteRevisionId: revision.id,
        commitSha: revision.commitSha!,
        name: REQUIRED_CHECK,
        conclusion,
        externalId: required?.externalId ?? null,
      },
      update: { conclusion, externalId: required?.externalId ?? null },
    });

    // Same transaction as the fact. A barrier that ran afterwards could read a
    // fact that a rollback then removed.
    await settleGeneration(tx, {
      generationRunId: params.generationRunId,
      requiredCheck: REQUIRED_CHECK,
    });
  });

  return { type: "concluido" };
}
