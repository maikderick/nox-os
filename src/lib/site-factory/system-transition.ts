import "server-only";

import { writeAudit } from "@/lib/settings";

import type { JobTransaction } from "@/lib/jobs/outbox";

import { isSystemTransition, type SiteProjectState } from "./states";
import { SiteProjectTransitionError } from "./states";

/**
 * A transition the orchestration reports, applied so that two observers cannot
 * both report it.
 *
 * Lives beside `states.ts` rather than inside it on purpose: `states.ts` is a
 * pure module that pages and client code import, and pulling Prisma into it
 * would drag the database client into a bundle that has no business holding
 * one. The rules stay there; the write lives here.
 *
 * **The race this exists to lose safely.** `checks.poll` and `preview.poll` are
 * siblings. They can finish in the same instant, in different cycles of the
 * consumer, and both will read three complete facts and both will conclude. So
 * the update is conditional on the state it is leaving:
 *
 * ```sql
 * UPDATE "SiteProject" SET "status" = $to WHERE "id" = $id AND "status" = $from
 * ```
 *
 * Zero rows is not an error. It means the sibling got there first. Whoever
 * updated writes the audit line **in the same transaction**; whoever did not
 * re-reads, recognises a terminal state, and writes nothing at all. One
 * observer transitions, one audits, and the audit line never comes out twice.
 *
 * **A terminal failure is terminal.** Because the condition requires the
 * `from` state, a sibling that finished later with a success cannot reverse it:
 * it finds `FALHOU`, does not find `GERANDO`, and does not write. There is no
 * path back from `FALHOU` to `PREVIA_PRONTA`.
 */

export type SystemTransitionParams = {
  siteProjectId: string;
  /** The state this transition is allowed to leave. The condition, literally. */
  from: SiteProjectState;
  to: SiteProjectState;
  /** Goes into the audit line's metadata. Closed codes only, never free text. */
  reasonCode: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type SystemTransitionResult = {
  /** True for the one caller whose update matched a row. */
  applied: boolean;
  /** What the project's status is now, whoever wrote it. */
  status: SiteProjectState | string;
};

export async function applySystemTransition(
  tx: JobTransaction,
  params: SystemTransitionParams,
): Promise<SystemTransitionResult> {
  // Asked of the state machine, not of this function's caller. A transition a
  // person is allowed to request is not one the orchestration may apply behind
  // their back, and the machine is the only thing that knows which is which.
  if (!isSystemTransition(params.from, params.to)) {
    throw new SiteProjectTransitionError(params.from, params.to);
  }

  const { count } = await tx.siteProject.updateMany({
    where: { id: params.siteProjectId, status: params.from },
    data: { status: params.to },
  });

  if (count === 0) {
    // The sibling won. Read what it decided and report that, without writing.
    const current = await tx.siteProject.findUnique({
      where: { id: params.siteProjectId },
      select: { status: true },
    });
    return { applied: false, status: current?.status ?? params.from };
  }

  // Same transaction as the status change, so there is no window in which the
  // project moved and nothing recorded why.
  await writeAudit({
    action: "site_project.transicao_de_sistema",
    entity: "SiteProject",
    entityId: params.siteProjectId,
    meta: { de: params.from, para: params.to, motivo: params.reasonCode, ...params.meta },
    db: tx,
  });

  return { applied: true, status: params.to };
}
