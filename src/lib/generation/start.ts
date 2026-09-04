import "server-only";

import { getCodeGenerationProvider } from "@/lib/codegen/registry";
import { buildAgentIsolation } from "@/lib/codegen/isolation";
import type { AgentRunRef, CodeGenerationProvider } from "@/lib/codegen/provider";
import { generationPriceCents } from "@/lib/credits/pricing";
import { reserveCredits } from "@/lib/credits/reserve";
import { conciliateReservation } from "@/lib/credits/settle";
import { prisma } from "@/lib/db";
import { getEffectiveMode } from "@/lib/integrations/settings-service";
import type { JobOutcome } from "@/lib/jobs/handlers";
import { enqueueJob } from "@/lib/jobs/outbox";
import { isSiteBriefV2, parseSiteBrief } from "@/lib/site-factory/brief-schema";

import { classifyStartError, dispositionFromStored, type StartDisposition } from "./disposition";
import { buildGenerationPrompt } from "./prompt";
import { GenerationRefusal } from "./reasons";

/**
 * Starting a generation: the one step in the chain that spends money and
 * cannot be undone.
 *
 * Everything here is arranged around a single sentence: **a remote effect is
 * never repeated blindly.** What decides whether it may be repeated is
 * `GenerationRun.startDisposition`, written *before* the call and read out of
 * the database afterwards — never the text of an error, and never the memory of
 * a process that may not have survived.
 *
 * The order below is the order in the plan, and each step exists because
 * skipping it loses something:
 *
 *  1. `INICIADO` — call nothing; go straight to the handoff.
 *  2. `EM_TENTATIVA` or `AMBIGUO` — repeat only if the provider declares
 *     `idempotentStart`; with `reconcileByKey`, ask first. With neither,
 *     conciliation.
 *  3. `SEM_EFEITO_COMPROVADO` — **reuse the existing reservation**, by the same
 *     `operationKey`, and carry on as if this were the first call.
 *  4. `NAO_TENTADO` — preflight, price, reservation, `credit.threshold` and
 *     `startAttemptedAt`, all in one transaction.
 *  5. write `EM_TENTATIVA` **and commit**, before the call.
 *  6. call the provider.
 *  7. success → `INICIADO` and `providerRunId`, **enqueueing `generation.poll`
 *     in the same transaction**; a typed, safe internal error →
 *     `SEM_EFEITO_COMPROVADO` and a recoverable failure, reservation intact;
 *     anything else → `AMBIGUO` and conciliation.
 *
 * Step 5 is a transaction of its own on purpose. Writing `EM_TENTATIVA`
 * together with the call would protect nothing: what has to be in the database
 * *before* the effect is precisely the mark that it may have happened.
 */

export type StartGenerationParams = {
  generationRunId: string;
  /**
   * Whether this consumer still holds the job.
   *
   * Asked immediately before the provider call and nowhere else. A handler
   * whose lease lapsed mid-run and that calls anyway produces exactly the
   * duplicate the lease exists to prevent, at the most expensive possible
   * moment.
   */
  stillOurs?: () => Promise<boolean>;
  /** Injected by tests to make the handoff fail after the provider answered. */
  enqueue?: typeof enqueueJob;
  /** Injected by tests. Otherwise chosen by the organization's mode. */
  provider?: CodeGenerationProvider;
};

type LoadedRun = {
  id: string;
  siteProjectId: string;
  organizationId: string;
  startDisposition: StartDisposition;
  providerRunId: string | null;
  providerIdempotencyKey: string | null;
};

function operationKeyFor(generationRunId: string): string {
  return `generation:${generationRunId}`;
}

/**
 * The key we send the provider.
 *
 * Derived from the run, so it is stable across every retry of the same run and
 * different for every other run. That stability is what makes `findRunByKey`
 * able to answer at all: a key generated per attempt would ask the provider
 * about something it has never seen.
 */
function providerKeyFor(generationRunId: string): string {
  return `nox-generation-${generationRunId}`;
}

async function loadRun(generationRunId: string): Promise<LoadedRun> {
  const run = await prisma.generationRun.findUnique({
    where: { id: generationRunId },
    select: {
      id: true,
      siteProjectId: true,
      startDisposition: true,
      providerRunId: true,
      providerIdempotencyKey: true,
      siteProject: { select: { organizationId: true } },
    },
  });

  // A `generation.start` whose run does not exist is a programming error, not a
  // condition to retry: the outbox only creates this job inside the transaction
  // that created the run.
  if (!run) throw new GenerationRefusal("RUN_INEXISTENTE");

  return {
    id: run.id,
    siteProjectId: run.siteProjectId,
    organizationId: run.siteProject.organizationId,
    startDisposition: dispositionFromStored(run.startDisposition),
    providerRunId: run.providerRunId,
    providerIdempotencyKey: run.providerIdempotencyKey,
  };
}

/**
 * Everything the agent needs, checked before any money moves.
 *
 * Deliberately **not** `assertProvisioningEligible`: that gate requires
 * `BRIEFING_PRONTO`, and by the time this runs the project is `GERANDO` — it
 * would refuse every generation it was asked about. What it checks that still
 * matters is checked here, against the state this step actually runs in.
 */
async function preflight(run: LoadedRun) {
  const project = await prisma.siteProject.findUnique({
    where: { id: run.siteProjectId },
    select: {
      name: true,
      currentBriefVersion: { select: { contentJson: true } },
      repository: { select: { owner: true, name: true, defaultBranch: true, protectedAt: true } },
      hostingProject: { select: { linkedAt: true } },
    },
  });

  if (!project?.currentBriefVersion) throw new GenerationRefusal("BRIEFING_AUSENTE");

  const repository = project.repository;
  // `protectedAt` rather than mere existence: an agent pointed at a repository
  // whose default branch was never protected can have its pull request merged
  // by nobody in particular, and the review the factory promises would be
  // optional.
  if (!repository || !repository.protectedAt) {
    throw new GenerationRefusal("REPOSITORIO_NAO_PROVISIONADO");
  }

  // Checked now, not when the preview poller runs. Discovering the site has
  // nowhere to deploy *after* paying the agent is discovering it too late.
  if (!project.hostingProject?.linkedAt) {
    throw new GenerationRefusal("HOSPEDAGEM_NAO_PROVISIONADA");
  }

  let brief;
  try {
    brief = parseSiteBrief(project.currentBriefVersion.contentJson);
  } catch {
    throw new GenerationRefusal("BRIEFING_AUSENTE");
  }
  if (!isSiteBriefV2(brief)) throw new GenerationRefusal("BRIEFING_AUSENTE");

  return {
    projectName: project.name,
    brief,
    repository: {
      owner: repository.owner,
      name: repository.name,
      baseBranch: repository.defaultBranch,
    },
  };
}

/** Writes the disposition, and nothing else. Its own transaction, on purpose. */
async function recordDisposition(
  runId: string,
  disposition: StartDisposition,
  extra: { providerRunId?: string | null; providerIdempotencyKey?: string } = {},
): Promise<void> {
  await prisma.generationRun.update({
    where: { id: runId },
    data: { startDisposition: disposition, ...extra },
  });
}

/**
 * Records that the provider started, and hands off — one transaction.
 *
 * The handoff is inside it because that is the rule of the chain: the next job
 * is created by the transaction that writes the fact justifying it. If the
 * enqueue fails, `providerRunId` is not written either, and the retry finds the
 * run through the provider rather than starting a second one.
 */
async function recordStartedAndHandOff(params: {
  run: LoadedRun;
  ref: AgentRunRef;
  enqueue: typeof enqueueJob;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.generationRun.update({
      where: { id: params.run.id },
      data: {
        startDisposition: "INICIADO",
        providerRunId: params.ref.id,
        providerIdempotencyKey: params.ref.idempotencyKey,
        status: "EXECUTANDO",
        startedAt: new Date(),
      },
    });

    await params.enqueue(tx, {
      organizationId: params.run.organizationId,
      step: { kind: "generation.poll", generationRunId: params.run.id },
    });
  });
}

/** Sends the run and its reservation to a person, and stops. */
async function toConciliation(run: LoadedRun): Promise<JobOutcome> {
  await prisma.$transaction(async (tx) => {
    await tx.generationRun.update({
      where: { id: run.id },
      data: { startDisposition: "AMBIGUO" },
    });

    // The reservation stays committed and the account is blocked. Releasing
    // here would refund work that may well have happened and been charged for.
    const reservation = await tx.creditReservation.findUnique({
      where: { generationRunId: run.id },
      select: { id: true, status: true },
    });
    if (reservation?.status === "RESERVADA") {
      await conciliateReservation(tx, {
        reservationId: reservation.id,
        reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
      });
    }
  });

  return {
    type: "falha_permanente",
    error: new GenerationRefusal("EFEITO_AMBIGUO"),
    as: "CONCILIACAO",
  };
}

export async function startGeneration(params: StartGenerationParams): Promise<JobOutcome> {
  const enqueue = params.enqueue ?? enqueueJob;
  const run = await loadRun(params.generationRunId);

  const mode = await getEffectiveMode(run.organizationId, "cursor");
  const provider = params.provider ?? getCodeGenerationProvider(mode);

  // 1. Already started. Nothing is called; the handoff is all that is left, and
  //    it is safe to repeat because the step key is the same one.
  if (run.startDisposition === "INICIADO" && run.providerRunId) {
    await prisma.$transaction(async (tx) => {
      await enqueue(tx, {
        organizationId: run.organizationId,
        step: { kind: "generation.poll", generationRunId: run.id },
      });
    });
    return { type: "concluido" };
  }

  // 2. The lease window, and the crash window. Both read as ambiguity.
  if (run.startDisposition === "EM_TENTATIVA" || run.startDisposition === "AMBIGUO") {
    const key = run.providerIdempotencyKey ?? providerKeyFor(run.id);

    if (provider.capabilities.reconcileByKey) {
      // Ask before deciding. Never decide from silence.
      const found = await provider.findRunByKey(key);
      if (found) {
        await recordStartedAndHandOff({ run, ref: found, enqueue });
        return { type: "concluido" };
      }
      // A provider that can look and found nothing has *proved* the call did
      // not take. That is the one thing that turns ambiguity back into a fresh
      // attempt — with the reservation that is already there.
      return callProvider({ run, provider, key, enqueue, stillOurs: params.stillOurs });
    }

    if (provider.capabilities.idempotentStart) {
      // Repeating is safe by the provider's own promise: the same key starts at
      // most one run, so the second call either adopts the first or is the
      // first.
      return callProvider({ run, provider, key, enqueue, stillOurs: params.stillOurs });
    }

    return toConciliation(run);
  }

  // 3 and 4. Either reuse the reservation of a proven-safe failure, or make one.
  if (run.startDisposition === "NAO_TENTADO") {
    const reserved = await reserveForRun(run);
    if (reserved.type !== "ok") return reserved.outcome;
  }
  // `SEM_EFEITO_COMPROVADO` deliberately reserves nothing. The reservation from
  // the previous attempt is still `RESERVADA` under the same `operationKey`,
  // and its watcher is still the same job. Releasing and re-reserving would
  // open a window for another generation to take the credit, create a second
  // `credit.threshold` for one intention, and fill the ledger with
  // release/reserve pairs describing no movement at all.

  return callProvider({
    run,
    provider,
    key: providerKeyFor(run.id),
    enqueue,
    stillOurs: params.stillOurs,
  });
}

type ReserveResult = { type: "ok" } | { type: "refused"; outcome: JobOutcome };

/**
 * Preflight, price, reservation, watcher and `startAttemptedAt`: one transaction.
 *
 * A refusal here is a typed error of ours, raised before anything left the
 * process — so it records `SEM_EFEITO_COMPROVADO` and fails recoverably. What
 * it must never do is reach the provider, which is why the whole of preflight
 * happens on this side of the call.
 */
async function reserveForRun(run: LoadedRun): Promise<ReserveResult> {
  try {
    await preflight(run);

    await prisma.$transaction(async (tx) => {
      const amountCents = await generationPriceCents(tx, run.organizationId);
      await reserveCredits(tx, {
        organizationId: run.organizationId,
        operationKey: operationKeyFor(run.id),
        amountCents,
        estimatedBy: "PRECO_DA_ORGANIZACAO",
        generationRunId: run.id,
      });
      await tx.generationRun.update({
        where: { id: run.id },
        data: { startAttemptedAt: new Date() },
      });
    });

    return { type: "ok" };
  } catch (error) {
    const disposition = classifyStartError(error);
    // Nothing was called, so nothing is ambiguous — unless the classification
    // does not recognise the error, in which case it says so and this becomes
    // conciliation rather than a retry.
    if (disposition === "AMBIGUO") {
      await recordDisposition(run.id, "AMBIGUO").catch(() => undefined);
      return { type: "refused", outcome: await toConciliation(run) };
    }

    await recordDisposition(run.id, "SEM_EFEITO_COMPROVADO").catch(() => undefined);
    return { type: "refused", outcome: { type: "falha_recuperavel", error } };
  }
}

async function callProvider(params: {
  run: LoadedRun;
  provider: CodeGenerationProvider;
  key: string;
  enqueue: typeof enqueueJob;
  stillOurs?: () => Promise<boolean>;
}): Promise<JobOutcome> {
  const { run, provider, key, enqueue } = params;

  let input;
  try {
    const context = await preflight(run);
    input = {
      idempotencyKey: key,
      isolation: buildAgentIsolation({ repos: [context.repository] }),
      prompt: buildGenerationPrompt({
        brief: context.brief,
        projectName: context.projectName,
        repository: context.repository,
      }),
    };

    if (!(await provider.isConfigured())) {
      throw new GenerationRefusal("PROVEDOR_NAO_CONFIGURADO");
    }
  } catch (error) {
    // Still on this side of the call: nothing went out, and the reservation
    // stays exactly where it is for the next attempt.
    const disposition = classifyStartError(error);
    if (disposition === "AMBIGUO") return toConciliation(run);
    await recordDisposition(run.id, "SEM_EFEITO_COMPROVADO").catch(() => undefined);
    return { type: "falha_recuperavel", error };
  }

  // The last question before the effect. A consumer that lost its lease must
  // not call: someone else owns this job now, and two owners calling is the
  // duplicate the lease exists to prevent.
  if (params.stillOurs && !(await params.stillOurs())) {
    return { type: "falha_recuperavel", error: new GenerationRefusal("EFEITO_AMBIGUO") };
  }

  // Committed **before** the call, in its own transaction. Whoever dies with
  // the call in flight leaves this behind, and this reads as ambiguity rather
  // than as permission to repeat.
  await recordDisposition(run.id, "EM_TENTATIVA", { providerIdempotencyKey: key });

  let ref: AgentRunRef;
  try {
    ref = await provider.start(input);
  } catch (error) {
    const disposition = classifyStartError(error);
    if (disposition === "SEM_EFEITO_COMPROVADO") {
      // A typed error of ours raised inside the provider — a disabled
      // integration, a refused isolation. Nothing was sent, the reservation
      // survives untouched, and the retry uses it.
      await recordDisposition(run.id, "SEM_EFEITO_COMPROVADO").catch(() => undefined);
      return { type: "falha_recuperavel", error };
    }
    return toConciliation(run);
  }

  try {
    await recordStartedAndHandOff({ run, ref, enqueue });
  } catch (error) {
    // The transaction rolled back, so `providerRunId` was not written — but the
    // agent **is** running. The disposition stays `EM_TENTATIVA`, and the next
    // attempt finds the run through `findRunByKey` instead of starting another.
    return { type: "falha_recuperavel", error };
  }

  return { type: "concluido" };
}
