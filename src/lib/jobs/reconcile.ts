import "server-only";

import type { Job } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Bringing back work whose consumer never came home.
 *
 * A serverless function can be killed at any point — budget exhausted, instance
 * recycled, deploy in the middle of a run. The job it held stays `EM_EXECUCAO`
 * with a lease nobody is renewing, and without this it would sit there
 * forever, blocking its project through the concurrency index.
 *
 * **The counters survive the reclaim, and that is the point.** A dead consumer
 * is not a failed job: nothing was tried and refused, the process simply
 * stopped existing. Spending an attempt here would let four deploys during a
 * long generation walk a perfectly healthy run into its dead letter, and
 * resetting `pollCount` would hand a stuck poll an unlimited new budget to be
 * stuck in. Neither number is ours to touch.
 *
 * `runAfter` is not moved either: the job was due, and it still is.
 *
 * Known gap, deliberate: a job that kills its consumer *every* time comes back
 * every time, because nothing distinguishes "the platform died" from "this job
 * kills whatever runs it". Telling them apart needs a counter this phase does
 * not add. Until then it is visible rather than silent — a job that keeps
 * reappearing shows up on the queue screen of commit 15.
 */
export async function reclaimExpiredLeases(): Promise<Job[]> {
  return prisma.$queryRaw<Job[]>`
    UPDATE "Job"
       SET "status" = 'PENDENTE',
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "updatedAt" = NOW()
     WHERE "status" = 'EM_EXECUCAO'
       AND "leaseExpiresAt" IS NOT NULL
       AND "leaseExpiresAt" <= NOW()
    RETURNING *
  `;
}
