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

/** `unique_violation`, the SQLSTATE PostgreSQL raises for a duplicate key. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether a failed write was a unique index refusing it.
 *
 * The same collision reaches us under two different codes, and which one
 * depends on how the statement was issued rather than on what happened:
 *
 *   * a **typed** write (`tx.job.update`) is reported as `P2002`, with the
 *     offending fields in `meta.target`;
 *   * a **raw** write (`$queryRaw`) is reported as `P2010` — "raw query failed"
 *     — with the driver's own error underneath, and the SQLSTATE in `meta.code`.
 *
 * The reprocess update is raw, because only raw SQL can make the decision and
 * the write the same statement. So it only ever produces `P2010`, and a handler
 * that knew about `P2002` alone would let a genuine "another generation is
 * already live for this project" escape as an unrecognised failure — a 500 with
 * a correlation id, where the operator deserved a sentence explaining that the
 * project is busy.
 *
 * The SQLSTATE is what is inspected, never the message: `meta.message` carries
 * the constraint name and the colliding value, and it is neither stable nor
 * ours to read.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002") return true;
  if (error.code !== "P2010") return false;
  return (error.meta as { code?: unknown } | undefined)?.code === UNIQUE_VIOLATION;
}

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
      // The partial index is behind the check above, for the race it cannot
      // see: the sibling that wins is uncommitted while this one reads, so the
      // read finds nothing and the index is what refuses.
      if (isUniqueViolation(error)) {
        throw new JobRefusal("TRABALHO_EM_ANDAMENTO");
      }
      // Any other raw failure keeps going up, and is sanitized like anything
      // else — a `P2010` with a different SQLSTATE is not a busy project.
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
