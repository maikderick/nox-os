import "server-only";

import { type Actor, assertPermission } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

/**
 * Moves an existing observer forward after a trusted signal. It never creates
 * work and never concludes it: polling remains the source of truth.
 */
export async function acceleratePendingJob(actor: Actor, jobId: string): Promise<boolean> {
  assertPermission(actor, "job:run");
  const { count } = await prisma.job.updateMany({
    where: {
      id: jobId,
      organizationId: actor.organizationId,
      kind: { in: ["generation.poll", "checks.poll", "preview.poll"] },
      status: "PENDENTE",
    },
    data: { runAfter: new Date() },
  });
  return count === 1;
}
