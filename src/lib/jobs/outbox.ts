import "server-only";

import { Prisma } from "@prisma/client";

import { isJobKind, isMutatingKind, ACTIVE_JOB_STATUSES } from "./kinds";
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
  /** Kind plus the identifiers its keys are built from. */
  step: JobKeyInput;
  payload: JobPayload;
  siteProjectId?: string | null;
  generationRunId?: string | null;
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

async function assertOwnership(
  tx: JobTransaction,
  params: Pick<EnqueueJobParams, "organizationId" | "siteProjectId" | "generationRunId">,
): Promise<void> {
  // The foreign keys say the project exists. They say nothing about whose it
  // is, and a job that names another organization's project would hand that
  // organization's work to this one's consumer.
  if (params.siteProjectId) {
    const project = await tx.siteProject.findUnique({
      where: { id: params.siteProjectId },
      select: { organizationId: true },
    });
    if (!project || project.organizationId !== params.organizationId) {
      throw new JobRefusal("PROJETO_DE_OUTRA_ORGANIZACAO");
    }
  }

  if (params.generationRunId) {
    const run = await tx.generationRun.findUnique({
      where: { id: params.generationRunId },
      select: { siteProject: { select: { organizationId: true } } },
    });
    if (!run || run.siteProject.organizationId !== params.organizationId) {
      throw new JobRefusal("RUN_DE_OUTRA_ORGANIZACAO");
    }
  }
}

/**
 * Enqueues one step, or returns the job that already represents it.
 *
 * Re-enqueueing the same step is not an error. A handler that dies between
 * doing its work and committing runs again, and the second run has to reach the
 * same queue state as the first — otherwise every retry would fan out a new
 * copy of the rest of the chain.
 */
export async function enqueueJob(tx: JobTransaction, params: EnqueueJobParams) {
  assertInsideTransaction(tx);

  const kind = params.step.kind;
  if (!isJobKind(kind)) throw new JobRefusal("TIPO_DESCONHECIDO", { kind });

  const keys = jobKeysFor(params.step);
  if (!keysAgreeWithKind(kind, keys)) throw new JobRefusal("CHAVES_INCOERENTES", { kind });

  const payloadJson = encodeJobPayload(params.payload);

  await assertOwnership(tx, params);

  const existing = await tx.job.findFirst({
    where: { organizationId: params.organizationId, idempotencyKey: keys.idempotencyKey },
  });
  if (existing) return existing;

  if (keys.concurrencyKey) {
    const active = await tx.job.findFirst({
      where: {
        concurrencyKey: keys.concurrencyKey,
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      select: { id: true },
    });
    if (active) {
      throw new JobRefusal("TRABALHO_EM_ANDAMENTO", { concurrencyKey: keys.concurrencyKey });
    }
  }

  try {
    return await tx.job.create({
      data: {
        organizationId: params.organizationId,
        siteProjectId: params.siteProjectId ?? null,
        generationRunId: params.generationRunId ?? null,
        kind,
        idempotencyKey: keys.idempotencyKey,
        concurrencyKey: keys.concurrencyKey,
        payloadJson,
        runAfter: params.runAfter ?? new Date(),
        maxAttempts: params.maxAttempts ?? 5,
        pollDeadlineAt: params.pollDeadlineAt ?? null,
      },
    });
  } catch (error) {
    // The read above is advisory; the index is what decides. Two transactions
    // can both find nothing and both try to write.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      isMutatingKind(kind)
    ) {
      throw new JobRefusal("TRABALHO_EM_ANDAMENTO", {
        concurrencyKey: keys.concurrencyKey ?? undefined,
      });
    }
    // A collision on the idempotency index means a concurrent transaction
    // enqueued the same step. It cannot be answered here — the transaction is
    // already aborted, so the existing row is unreadable. Letting it propagate
    // rolls back the fact together with the job, and the retry finds both.
    throw error;
  }
}
