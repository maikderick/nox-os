import "server-only";

import { Prisma } from "@prisma/client";

import type { AgentRunStatus, CodeGenerationProvider } from "@/lib/codegen/provider";
import { getCodeGenerationProvider } from "@/lib/codegen/registry";
import { consumeReservation } from "@/lib/credits/settle";
import { prisma } from "@/lib/db";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import type { JobOutcome } from "@/lib/jobs/handlers";
import { enqueueJob, type JobTransaction } from "@/lib/jobs/outbox";
import { applySystemTransition } from "@/lib/site-factory/system-transition";

import { GenerationRefusal } from "./reasons";

/**
 * Watching the agent, and handing the result to the two observers.
 *
 * This step **observes and persists**. It applies no project transition: the
 * agent finishing is not the generation finishing, and saying so here would
 * mark a project ready before anything had verified the code it produced.
 *
 * Every visit starts by asking what is already done. A `SiteRevision` for this
 * run means the agent already finished and was already recorded; the only thing
 * left is the handoff, which is safe to repeat because the sibling jobs are
 * keyed by run and commit.
 */

/** How long between polls while the agent works. */
export const AGENT_POLL_DELAY_SECONDS = 30;

export type PollGenerationParams = {
  generationRunId: string;
  /** Injected by tests. Otherwise chosen by the organization's mode. */
  provider?: CodeGenerationProvider;
  enqueue?: typeof enqueueJob;
};

type LoadedRun = {
  id: string;
  siteProjectId: string;
  organizationId: string;
  providerRunId: string | null;
  providerIdempotencyKey: string | null;
  revisionId: string | null;
  revisionCommitSha: string | null;
};

async function loadRun(generationRunId: string): Promise<LoadedRun> {
  const run = await prisma.generationRun.findUnique({
    where: { id: generationRunId },
    select: {
      id: true,
      siteProjectId: true,
      providerRunId: true,
      providerIdempotencyKey: true,
      siteProject: { select: { organizationId: true } },
      revision: { select: { id: true, commitSha: true } },
    },
  });
  if (!run) throw new GenerationRefusal("RUN_INEXISTENTE");

  return {
    id: run.id,
    siteProjectId: run.siteProjectId,
    organizationId: run.siteProject.organizationId,
    providerRunId: run.providerRunId,
    providerIdempotencyKey: run.providerIdempotencyKey,
    revisionId: run.revision?.id ?? null,
    revisionCommitSha: run.revision?.commitSha ?? null,
  };
}

/**
 * Enqueues the two observers, in the transaction that recorded the revision.
 *
 * They are **siblings, not a sequence**: they run in any order, in any cycle of
 * the consumer, and whichever finishes last finds three facts and closes the
 * generation. Locking them by project — which is what a `concurrencyKey` would
 * do — is exactly what kept the chain from moving.
 */
async function handOffToObservers(
  tx: JobTransaction,
  params: { run: LoadedRun; commitSha: string; siteRevisionId: string; enqueue: typeof enqueueJob },
): Promise<void> {
  for (const kind of ["checks.poll", "preview.poll"] as const) {
    await params.enqueue(tx, {
      organizationId: params.run.organizationId,
      step: { kind, generationRunId: params.run.id, commitSha: params.commitSha },
      payload: { siteRevisionId: params.siteRevisionId },
    });
  }
}

/**
 * Records the revision, the usage and the two siblings — one transaction.
 *
 * `SiteRevision.generationRunId` is unique, and that index is the whole reason
 * this is safe under a lapsed lease: two handlers of the same run finishing at
 * once produce one revision and one usage line, and the loser re-reads,
 * recognises the revision that exists, and carries on to the handoff.
 */
async function recordRevision(params: {
  run: LoadedRun;
  status: AgentRunStatus;
  enqueue: typeof enqueueJob;
}): Promise<{ siteRevisionId: string; commitSha: string }> {
  const commitSha = params.status.commitSha;
  // Without a commit there is nothing to verify, and the barrier would have no
  // second and third fact to align against a first.
  if (!commitSha) throw new GenerationRefusal("COMMIT_AUSENTE");

  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.siteRevision.aggregate({
        where: { siteProjectId: params.run.siteProjectId },
        _max: { version: true },
      });

      const revision = await tx.siteRevision.create({
        data: {
          siteProjectId: params.run.siteProjectId,
          generationRunId: params.run.id,
          version: (previous._max.version ?? 0) + 1,
          commitSha,
          summary: params.status.pullRequestUrl ?? null,
          // The snapshot the site is built from lives in the repository; what
          // this row holds is the pointer to the commit that holds it.
          manifestJson: JSON.stringify({
            branch: params.status.branch ?? null,
            commitSha,
            pullRequestUrl: params.status.pullRequestUrl ?? null,
          }),
        },
      });

      await tx.generationRun.update({
        where: { id: params.run.id },
        data: {
          status: "CONCLUIDO",
          finishedAt: new Date(),
          branch: params.status.branch ?? null,
          pullRequestUrl: params.status.pullRequestUrl ?? null,
        },
      });

      // Usage records **execution**, once, keyed by the run. The reference is
      // what makes a resumed poll not count the same generation twice.
      await tx.usageLedger.create({
        data: {
          organizationId: params.run.organizationId,
          siteProjectId: params.run.siteProjectId,
          kind: "GERACAO",
          reference: params.run.id,
        },
      });

      await handOffToObservers(tx, {
        run: params.run,
        commitSha,
        siteRevisionId: revision.id,
        enqueue: params.enqueue,
      });

      return { siteRevisionId: revision.id, commitSha };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    // The unique index knocked the second handler down. Re-read, adopt what the
    // winner wrote, and finish the handoff — which is itself idempotent.
    const existing = await prisma.siteRevision.findUnique({
      where: { generationRunId: params.run.id },
      select: { id: true, commitSha: true },
    });
    if (!existing?.commitSha) throw error;

    await prisma.$transaction(async (tx) => {
      await handOffToObservers(tx, {
        run: params.run,
        commitSha: existing.commitSha!,
        siteRevisionId: existing.id,
        enqueue: params.enqueue,
      });
    });

    return { siteRevisionId: existing.id, commitSha: existing.commitSha };
  }
}

/**
 * The agent itself failed. The project fails with it, and the work is paid for.
 *
 * Consuming rather than releasing is the honest reading: the agent ran. A
 * generation that produced nothing usable still consumed the run it was
 * charged for, and refunding it here would make the ledger describe a call that
 * never happened.
 */
async function recordAgentFailure(run: LoadedRun): Promise<JobOutcome> {
  await prisma.$transaction(async (tx) => {
    await tx.generationRun.update({
      where: { id: run.id },
      data: { status: "FALHOU", finishedAt: new Date() },
    });

    const reservation = await tx.creditReservation.findUnique({
      where: { generationRunId: run.id },
      select: { id: true, status: true, amountCents: true },
    });
    if (reservation?.status === "RESERVADA") {
      await consumeReservation(tx, {
        reservationId: reservation.id,
        actualCents: reservation.amountCents,
      });
    }

    await applySystemTransition(tx, {
      siteProjectId: run.siteProjectId,
      from: "GERANDO",
      to: "FALHOU",
      reasonCode: "AGENTE_FALHOU",
    });
  });

  // The job did its work: it observed, and it recorded what it observed. The
  // failure belongs to the generation, not to the step.
  return { type: "concluido" };
}

export async function pollGeneration(params: PollGenerationParams): Promise<JobOutcome> {
  const enqueue = params.enqueue ?? enqueueJob;
  const run = await loadRun(params.generationRunId);

  // Already recorded. Everything left is the handoff, and it is keyed so that
  // repeating it enqueues nothing new.
  if (run.revisionId && run.revisionCommitSha) {
    await prisma.$transaction(async (tx) => {
      await handOffToObservers(tx, {
        run,
        commitSha: run.revisionCommitSha!,
        siteRevisionId: run.revisionId!,
        enqueue,
      });
    });
    return { type: "concluido" };
  }

  // A poll with nothing to poll is a run that never started. That is a
  // programming error in the chain, not something to wait out.
  if (!run.providerRunId) throw new GenerationRefusal("RUN_INEXISTENTE");

  const mode = await getEffectiveMode(run.organizationId, "cursor");
  const provider = params.provider ?? getCodeGenerationProvider(mode);

  const status = await provider.poll({
    id: run.providerRunId,
    idempotencyKey: run.providerIdempotencyKey ?? "",
  });

  if (status.state === "PENDENTE" || status.state === "EXECUTANDO") {
    // Waiting is not failing. This counts `pollCount`, honours
    // `pollDeadlineAt`, consumes no attempt and applies no backoff.
    return { type: "aguardar", delaySeconds: AGENT_POLL_DELAY_SECONDS };
  }

  if (status.state === "FALHOU" || status.state === "CANCELADO") {
    return recordAgentFailure(run);
  }

  await recordRevision({ run, status, enqueue });
  return { type: "concluido" };
}
