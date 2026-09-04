import "server-only";

import { prisma } from "@/lib/db";

import { DEFAULT_LEASE_SECONDS } from "./claim";

/**
 * Keeping a lease alive, and only your own.
 *
 * A handler that is genuinely still working — an agent poll inside its budget,
 * a long provider call — extends its claim rather than letting the lease lapse
 * and be reclaimed under it. The condition is the interesting part: the update
 * matches on `leaseOwner` as well as `id`, so a consumer that already lost the
 * job cannot quietly take it back by continuing to beat.
 *
 * Both functions read the clock with `NOW()`, for the same reason `claimJob`
 * does: a lease compared against the process's own clock is two clocks, and the
 * one that decides has to be the one every consumer shares.
 */
export type ExtendLeaseParams = {
  jobId: string;
  owner: string;
  leaseSeconds?: number;
};

/**
 * Returns whether the extension landed, instead of throwing.
 *
 * Losing a lease is a normal outcome for a slow consumer, and the caller's
 * answer is to stop working, not to fail the job someone else now owns.
 */
export async function extendLease(params: ExtendLeaseParams): Promise<boolean> {
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

  const updated = await prisma.$executeRaw`
    UPDATE "Job"
       SET "leaseExpiresAt" = NOW() + make_interval(secs => ${leaseSeconds}::double precision),
           "updatedAt" = NOW()
     WHERE "id" = ${params.jobId}
       AND "leaseOwner" = ${params.owner}
       AND "status" = 'EM_EXECUCAO'
       AND "leaseExpiresAt" > NOW()
  `;

  return updated === 1;
}

/**
 * Whether this consumer still holds the job.
 *
 * Asked before a step with a remote effect: a handler that lost its lease and
 * calls anyway produces exactly the duplicate the whole design exists to
 * prevent.
 */
export async function holdsLease(params: { jobId: string; owner: string }): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
      FROM "Job"
     WHERE "id" = ${params.jobId}
       AND "leaseOwner" = ${params.owner}
       AND "status" = 'EM_EXECUCAO'
       AND "leaseExpiresAt" > NOW()
     LIMIT 1
  `;
  return rows.length === 1;
}
