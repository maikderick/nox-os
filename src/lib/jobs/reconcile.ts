import "server-only";

import type { Job } from "@prisma/client";

import { prisma } from "@/lib/db";

import { buildJobReasonMessage } from "./reasons";

/**
 * Bringing back work whose consumer never came home.
 *
 * A serverless function can be killed at any point — budget exhausted, instance
 * recycled, deploy in the middle of a run. The job it held stays `EM_EXECUCAO`
 * with a lease nobody is renewing, and without this it would sit there
 * forever, blocking its project through the concurrency index.
 *
 * **`attempts` and `pollCount` survive the reclaim, and that is the point.** A
 * dead consumer is not a failed job: nothing was tried and refused, the process
 * simply stopped existing. Spending an attempt here would let four deploys
 * during a long generation walk a perfectly healthy run into its dead letter,
 * and resetting `pollCount` would hand a stuck poll an unlimited new budget to
 * be stuck in. Neither number is ours to touch.
 *
 * `runAfter` is not moved either: the job was due, and it still is.
 *
 * What *is* counted is the reclaim itself. "The platform died" and "this job
 * kills whatever runs it" produce the same row, and only repetition tells them
 * apart — so the third recovery stops trying. The job goes to `CONCILIACAO`,
 * where a person looks at it, rather than round the loop again taking a
 * consumer with it each time.
 */

/**
 * How many times a job may be rescued before the rescuing itself becomes the
 * evidence.
 *
 * Three, not one: a single deploy landing mid-run is ordinary, and two in a row
 * is bad luck. Three consumers dying on the same job is a pattern.
 */
export const MAX_LEASE_RECOVERIES = 3;

export type ReclaimParams = {
  /**
   * Narrows the reclaim to one organization, exactly as `claimJob` does.
   *
   * A tenant asking for their own queue to move must not resurrect another
   * tenant's stuck job — the reclaim would count a recovery against a job the
   * caller has no business touching, and three such requests would send it to
   * conciliation.
   */
  organizationId?: string;
};

export async function reclaimExpiredLeases(params: ReclaimParams = {}): Promise<Job[]> {
  // Built here, from the closed reason, exactly like every other stored text.
  const exhausted = buildJobReasonMessage("RESGATES_SUCESSIVOS");
  const organizationId = params.organizationId ?? null;

  return prisma.$queryRaw<Job[]>`
    UPDATE "Job"
       SET "leaseRecoveryCount" = "leaseRecoveryCount" + 1,
           "status" = CASE
             WHEN "leaseRecoveryCount" + 1 >= ${MAX_LEASE_RECOVERIES} THEN 'CONCILIACAO'
             ELSE 'PENDENTE'
           END,
           "lastErrorCode" = CASE
             WHEN "leaseRecoveryCount" + 1 >= ${MAX_LEASE_RECOVERIES} THEN 'RESGATES_SUCESSIVOS'
             ELSE "lastErrorCode"
           END,
           "lastError" = CASE
             WHEN "leaseRecoveryCount" + 1 >= ${MAX_LEASE_RECOVERIES} THEN ${exhausted}
             ELSE "lastError"
           END,
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "updatedAt" = NOW()
     WHERE "status" = 'EM_EXECUCAO'
       AND "leaseExpiresAt" IS NOT NULL
       AND "leaseExpiresAt" <= NOW()
       AND (${organizationId}::text IS NULL OR "organizationId" = ${organizationId}::text)
    RETURNING *
  `;
}
