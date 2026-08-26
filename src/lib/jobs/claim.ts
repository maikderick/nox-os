import "server-only";

import type { Job } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Acquiring one job, and only one.
 *
 * There is no worker in this process — serverless does not sustain a live loop
 * — so the consumer is a route with a budget that asks for work on demand. Two
 * of those routes can be awake at the same time, and on a one-minute cron they
 * usually are, so acquisition has to be decided by the database.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole point: the second consumer does not
 * wait behind the first for a row it will not get, and does not read it either.
 * It steps over the locked row and takes the next one. Prisma 5 cannot express
 * this, so it is raw SQL with an integration test of its own — a mock would
 * only assert a belief about PostgreSQL.
 *
 * **One clock.** Every instant here comes from `NOW()`, never from the process.
 * A job written with `runAfter` defaulting to `CURRENT_TIMESTAMP` and then
 * compared against a `new Date()` computed in Node is comparing two clocks that
 * agree only by luck: a database twenty milliseconds ahead makes a job that is
 * due look like a job that is not, and the queue quietly stalls for a tick.
 * There are as many consumer processes as the platform decides to start, and
 * exactly one database.
 */

/**
 * How long a claim is good for, in seconds.
 *
 * Tied to the consumer's own ceiling: `maxDuration = 300` on the route, so a
 * five-minute lease cannot expire while the holder is still legitimately
 * running. Longer would leave a dead consumer's work parked; shorter would let
 * a live one be reclaimed underneath itself.
 */
export const DEFAULT_LEASE_SECONDS = 300;

export type ClaimJobParams = {
  /** Identifies the consumer holding the lease. Never a secret. */
  owner: string;
  leaseSeconds?: number;
};

/**
 * Takes the next due job, or returns null when there is nothing to do.
 *
 * `PAUSADO` is claimable once `runAfter` has passed. That is where resuming
 * from the global brake begins: a paused job is not parked forever waiting for
 * someone to notice, it comes back on its own and the brake decides again.
 *
 * Acquiring does **not** touch `attempts`. Picking work up is not failing at
 * it, and counting it here would walk a job to its dead letter for the sole
 * offence of having been looked at five times.
 */
export async function claimJob(params: ClaimJobParams): Promise<Job | null> {
  const leaseSeconds = params.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

  const rows = await prisma.$queryRaw<Job[]>`
    WITH proximo AS (
      SELECT "id"
        FROM "Job"
       WHERE "status" IN ('PENDENTE', 'PAUSADO')
         AND "runAfter" <= NOW()
         AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
       ORDER BY "runAfter" ASC, "createdAt" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    )
    UPDATE "Job" AS j
       SET "status" = 'EM_EXECUCAO',
           "leaseOwner" = ${params.owner},
           "leaseExpiresAt" = NOW() + make_interval(secs => ${leaseSeconds}::double precision),
           "updatedAt" = NOW()
      FROM proximo
     WHERE j."id" = proximo."id"
    RETURNING j.*
  `;

  return rows[0] ?? null;
}
