import "server-only";

import { Prisma } from "@prisma/client";

import {
  agreeOn,
  contentMatches,
  identityFromStep,
  mergePayload,
  type ImmutableContent,
} from "./identity";
import { ACTIVE_JOB_STATUSES, isJobKind } from "./kinds";
import { jobKeysFor, keysAgreeWithKind, type JobKeyInput } from "./keys";
import { encodeJobPayload, type JobPayload } from "./payload";
import { JobRefusal } from "./reasons";

/**
 * The transactional outbox.
 *
 * A job is only ever created inside the transaction that writes the fact
 * justifying it. That is the whole idea: enqueueing outside means the queue can
 * hold work for something that never happened, and the handler then acts on a
 * world that does not exist. The reverse — the fact committed and the job lost
 * — is the failure this shape prevents, because both fall together.
 *
 * The transaction is therefore not a convention here; it is checked.
 */
export type JobTransaction = Prisma.TransactionClient;

export type EnqueueJobParams = {
  organizationId: string;
  /** What the job is. Keys, foreign keys and payload all come from here. */
  step: JobKeyInput;
  /**
   * Fields the step does not determine. Overlapping ones must match exactly —
   * this is not a place to override the step, only to add to it.
   */
  payload?: JobPayload;
  /** Optional, and checked rather than trusted. See `identity.ts`. */
  siteProjectId?: string | null;
  generationRunId?: string | null;
  /** Omitted means "now", decided by PostgreSQL rather than by this process. */
  runAfter?: Date;
  maxAttempts?: number;
  /** Deadline for waiting, not for failing. Null means the step never waits. */
  pollDeadlineAt?: Date | null;
};

/**
 * A root `PrismaClient` carries `$transaction`; an interactive transaction
 * client does not. That difference is the only reliable way to tell them apart
 * at runtime, and it is worth checking: `enqueueJob(prisma, …)` type-checks
 * happily and would silently create work outside any transaction.
 */
function assertInsideTransaction(tx: JobTransaction): void {
  if (typeof (tx as { $transaction?: unknown }).$transaction === "function") {
    throw new JobRefusal("FORA_DE_TRANSACAO");
  }
}

/**
 * Resolves the project from the run, and refuses every way the two can disagree.
 *
 * The foreign keys say the rows exist. They say nothing about whose they are,
 * nor about whether they belong together — and a `generation.start` whose key
 * names project A while its run belongs to project B would lock A while
 * generating B, which is worse than either mistake alone.
 */
async function resolveOwnership(
  tx: JobTransaction,
  params: {
    organizationId: string;
    kind: string;
    generationRunId: string | null;
    siteProjectId: string | null;
  },
): Promise<{ generationRunId: string | null; siteProjectId: string | null }> {
  // Checked first so an explicit project of another organization is named as
  // that, rather than as a disagreement with its run.
  if (params.siteProjectId) {
    const project = await tx.siteProject.findUnique({
      where: { id: params.siteProjectId },
      select: { organizationId: true },
    });
    if (!project || project.organizationId !== params.organizationId) {
      throw new JobRefusal("PROJETO_DE_OUTRA_ORGANIZACAO");
    }
  }

  if (!params.generationRunId) {
    return { generationRunId: null, siteProjectId: params.siteProjectId };
  }

  const run = await tx.generationRun.findUnique({
    where: { id: params.generationRunId },
    select: { siteProjectId: true, siteProject: { select: { organizationId: true } } },
  });
  if (!run || run.siteProject.organizationId !== params.organizationId) {
    throw new JobRefusal("RUN_DE_OUTRA_ORGANIZACAO");
  }

  // Same tenant, wrong project. Nothing above catches this: both rows are ours,
  // both pass every constraint, and only their relationship is wrong.
  if (params.siteProjectId && params.siteProjectId !== run.siteProjectId) {
    throw new JobRefusal("RUN_DE_OUTRO_PROJETO");
  }

  // Derived, not asked for: an observer that named no project still gets one,
  // so the queue screen can show it under the project it belongs to.
  return { generationRunId: params.generationRunId, siteProjectId: run.siteProjectId };
}

function targetOf(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

/**
 * Enqueues one step, or returns the job that already represents it.
 *
 * Re-enqueueing the same step is not an error. A handler that dies between
 * doing its work and committing runs again, and the second run has to reach the
 * same queue state as the first — otherwise every retry would fan out a new
 * copy of the rest of the chain.
 *
 * Re-enqueueing it as something *else* is an error, and a bad one: the key
 * would then name two different jobs depending on who asked first.
 */
export async function enqueueJob(tx: JobTransaction, params: EnqueueJobParams) {
  assertInsideTransaction(tx);

  const kind = params.step.kind;
  if (!isJobKind(kind)) throw new JobRefusal("TIPO_DESCONHECIDO");

  const keys = jobKeysFor(params.step);
  if (!keysAgreeWithKind(kind, keys)) throw new JobRefusal("CHAVES_INCOERENTES", { kind });

  const derived = identityFromStep(params.step);
  const asked = {
    generationRunId: agreeOn(derived.generationRunId, params.generationRunId, kind),
    siteProjectId: agreeOn(derived.siteProjectId, params.siteProjectId, kind),
  };

  const owned = await resolveOwnership(tx, { organizationId: params.organizationId, kind, ...asked });

  const payload = mergePayload(derived.payload, params.payload, kind);
  const wanted: ImmutableContent = {
    kind,
    concurrencyKey: keys.concurrencyKey,
    siteProjectId: owned.siteProjectId,
    generationRunId: owned.generationRunId,
    payloadJson: encodeJobPayload(payload),
  };

  const existing = await tx.job.findFirst({
    where: { organizationId: params.organizationId, idempotencyKey: keys.idempotencyKey },
  });
  if (existing) {
    if (!contentMatches(existing, wanted)) {
      throw new JobRefusal("CHAVE_REUSADA_COM_OUTRO_CONTEUDO", { kind });
    }
    return existing;
  }

  if (keys.concurrencyKey) {
    const active = await tx.job.findFirst({
      where: {
        concurrencyKey: keys.concurrencyKey,
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      select: { id: true },
    });
    if (active) {
      throw new JobRefusal("TRABALHO_EM_ANDAMENTO", { kind });
    }
  }

  try {
    return await tx.job.create({
      data: {
        organizationId: params.organizationId,
        idempotencyKey: keys.idempotencyKey,
        ...wanted,
        // Omitted on purpose when the caller said nothing: the column defaults
        // to `CURRENT_TIMESTAMP`, so "now" is the database's now.
        ...(params.runAfter ? { runAfter: params.runAfter } : {}),
        maxAttempts: params.maxAttempts ?? 5,
        pollDeadlineAt: params.pollDeadlineAt ?? null,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    // The reads above are advisory; the indexes decide. Which index fired
    // changes what actually happened, so they are not the same answer:
    const target = targetOf(error);

    if (target.includes("concurrencyKey")) {
      // Another mutating job for this project won the race.
      throw new JobRefusal("TRABALHO_EM_ANDAMENTO", { kind });
    }

    if (target.includes("idempotencyKey")) {
      // Another transaction enqueued this very step. Not "work in progress" —
      // it cannot be answered with the existing row either, because this
      // transaction is already aborted and cannot read it. Rolling back takes
      // the fact with it, and the retry finds both.
      throw new JobRefusal("ETAPA_ENFILEIRADA_CONCORRENTEMENTE", { kind });
    }

    throw error;
  }
}
