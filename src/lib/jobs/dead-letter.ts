import "server-only";

import type { Job } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { type Actor, assertPermission } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/settings";

import { pollDeadlineSecondsFor } from "./deadlines";
import { ACTIVE_JOB_STATUSES, isJobKind, isJobStatus } from "./kinds";
import { JobRefusal } from "./reasons";

/**
 * The dead letter, and the one way out of it.
 *
 * A job that exhausted its attempts is terminal on purpose: the project is
 * unblocked, and nothing retries on its own. Coming back is a decision someone
 * makes, with a name attached — which is why it needs `job:run` rather than
 * `job:read`, and why the reset and its audit entry commit together.
 */

export async function listDeadLetters(actor: Actor, limit = 50): Promise<Job[]> {
  assertPermission(actor, "job:read");

  return prisma.job.findMany({
    where: { organizationId: actor.organizationId, status: "CARTA_MORTA" },
    orderBy: { finishedAt: "desc" },
    take: limit,
  });
}

/**
 * Puts a dead letter back in the queue.
 *
 * Precisely what it does, because "clean slate" is not true and would be a bad
 * thing to believe:
 *
 *   * `attempts`, `pollCount` and `leaseRecoveryCount` go to zero. The
 *     operator is saying the reason it failed is gone; a reprocess that kept
 *     the old count would get one try and die again.
 *   * `pollDeadlineAt` is **renewed** from the closed policy for this kind, not
 *     preserved and not cleared. Preserving it would restart a poll whose
 *     patience already ran out months ago, and it would give up on the first
 *     look; clearing it would hand it unlimited patience. Both are worse than
 *     giving it the same budget a fresh job of that kind gets.
 *   * `runAfter` becomes `NOW()` — the database's, like everything else in the
 *     queue.
 *   * the lease, the pause reason and the recorded failure are cleared.
 *
 * What it does **not** do is bypass the exclusion. Reprocessing a
 * `generation.start` while another one is live for the same project would start
 * a second paid generation, which is precisely the thing the concurrency key
 * exists to prevent — and the operator asking for it has no way of knowing that
 * from the dead letter screen. The check is here, and the partial unique index
 * is behind it for the race.
 */
export async function reprocessDeadLetter(actor: Actor, jobId: string): Promise<Job> {
  assertPermission(actor, "job:run");

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({
      where: { id: jobId, organizationId: actor.organizationId },
    });

    // Same answer for "not yours" and "not there": a reprocess route must not
    // become a way to discover which job ids exist in another organization.
    if (!job || job.status !== "CARTA_MORTA") {
      throw new JobRefusal("JOB_NAO_REPROCESSAVEL", {
        status: isJobStatus(job?.status) ? job.status : undefined,
      });
    }

    if (job.concurrencyKey) {
      const live = await tx.job.findFirst({
        where: {
          concurrencyKey: job.concurrencyKey,
          status: { in: [...ACTIVE_JOB_STATUSES] },
          id: { not: job.id },
        },
        select: { id: true },
      });
      if (live) {
        throw new JobRefusal("TRABALHO_EM_ANDAMENTO");
      }
    }

    const patience = isJobKind(job.kind) ? pollDeadlineSecondsFor(job.kind) : null;

    let revived: Job | undefined;
    try {
      // The read above is advisory. This `WHERE` is what decides: two operators
      // clicking at once both see `CARTA_MORTA`, both reach here, and the
      // second one re-evaluates the predicate after the first commits — finding
      // a row that is no longer dead, and matching nothing. One revival, one
      // audit entry, and the loser is told plainly.
      const rows = await tx.$queryRaw<Job[]>`
        UPDATE "Job"
           SET "status" = 'PENDENTE',
               "attempts" = 0,
               "pollCount" = 0,
               "leaseRecoveryCount" = 0,
               "runAfter" = NOW(),
               "pollDeadlineAt" = CASE
                 WHEN ${patience}::double precision IS NULL THEN NULL
                 ELSE NOW() + make_interval(secs => ${patience}::double precision)
               END,
               "finishedAt" = NULL,
               "leaseOwner" = NULL,
               "leaseExpiresAt" = NULL,
               "pausedReason" = NULL,
               "lastError" = NULL,
               "lastErrorCode" = NULL,
               "correlationId" = NULL,
               "updatedAt" = NOW()
         WHERE "id" = ${job.id}
           AND "organizationId" = ${actor.organizationId}
           AND "status" = 'CARTA_MORTA'
        RETURNING *
      `;
      revived = rows[0];
    } catch (error) {
      // The partial index is behind the check above, for the race it cannot see.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new JobRefusal("TRABALHO_EM_ANDAMENTO");
      }
      throw error;
    }

    if (!revived) {
      throw new JobRefusal("JOB_NAO_REPROCESSAVEL", { status: "CARTA_MORTA" });
    }

    // The revival and its record commit together. A job back in the queue with
    // nobody's name on it, or a name recorded for a revival that rolled back,
    // are both worse than either operation failing: a review cannot tell them
    // apart afterwards.
    await writeAudit({
      db: tx,
      userId: actor.userId,
      action: "job.reprocessado",
      entity: "Job",
      entityId: job.id,
      meta: {
        kind: job.kind,
        organizationId: actor.organizationId,
        // The attempts it had spent, and the closed code it died with. Never
        // `lastError`, which is text.
        attemptsAnteriores: job.attempts,
        codigoAnterior: job.lastErrorCode,
      },
    });

    return revived;
  });
}
