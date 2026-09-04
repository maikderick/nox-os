import "server-only";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { hashRequest, withIdempotency } from "@/lib/jobs/idempotency";
import { enqueueJob } from "@/lib/jobs/outbox";
import { statesWithTransitionTo } from "@/lib/site-factory/states";

import { GenerationRefusal } from "./reasons";

/**
 * Asking for a generation, once.
 *
 * Four writes, one transaction, in an order that is not interchangeable:
 *
 *  1. the route validates `Idempotency-Key` — absent or not a UUID is a `400`,
 *     before anything is written;
 *  2. `withIdempotency` in scope `generation.request`, with the client's key
 *     and `sideEffect = LOCAL`; the same key with a different body is a `409`;
 *  3. the `GenerationRun` is created, `PENDENTE`;
 *  4. the project moves to `GERANDO` by **conditional update**;
 *  5. `generation.start` is enqueued.
 *
 * **Idempotency comes before the run** because it is the thing that stops the
 * second run existing. Deriving a key from the run would be too late: the key
 * would come from a row created in the same transaction, and two concurrent
 * transactions would produce two different keys and two runs.
 *
 * **The key is the client's, and it must be.** The previous design derived it
 * from `<siteProjectId>:<currentBriefVersionId>`, which conflated two different
 * things: a network retry and a deliberate second generation of the same site
 * with the same brief produced the same key, so the second *intention* was
 * swallowed as a duplicate. Only the caller knows which one it is — a retry
 * reuses the key, a new intention generates one.
 */

/** Nothing else may be requested through this door. */
export const GENERATION_REQUEST_SCOPE = "generation.request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A UUID, and specifically a *well-formed* one.
 *
 * The format is required rather than merely "some string" so that a client
 * cannot use a constant. `"retry"` is a valid string and a catastrophic key: it
 * would make every generation this organization ever asked for the same
 * request, and the second one would be answered with the first one's result.
 */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type RequestGenerationParams = {
  actor: Actor;
  siteProjectId: string;
  idempotencyKey: string;
  /** Injected by tests, to make the enqueue fail after the run exists. */
  enqueue?: typeof enqueueJob;
};

export type RequestGenerationResult = {
  generationRunId: string;
  jobId: string;
  /** False when the recorded response was served instead of running again. */
  executed: boolean;
};

export async function requestGeneration(
  params: RequestGenerationParams,
): Promise<RequestGenerationResult> {
  // Checked on the actor, before the key: a caller without `generation:run`
  // must not be able to burn an idempotency key, which would then refuse the
  // authorised caller who reused it.
  assertPermission(params.actor, "generation:run");

  if (!isValidIdempotencyKey(params.idempotencyKey)) {
    throw new GenerationRefusal("CHAVE_DE_REQUISICAO_INVALIDA");
  }

  const enqueue = params.enqueue ?? enqueueJob;
  const body = { siteProjectId: params.siteProjectId };

  const outcome = await withIdempotency(
    {
      organizationId: params.actor.organizationId,
      scope: GENERATION_REQUEST_SCOPE,
      key: params.idempotencyKey,
      requestHash: hashRequest(body),
      // Creating a run, transitioning and enqueueing are all our own writes, in
      // one transaction, and entirely reconcilable. This is the only scope that
      // may be taken over on expiry without risk.
      sideEffect: "LOCAL",
    },
    async (tx) => {
      const project = await tx.siteProject.findFirst({
        where: { id: params.siteProjectId, organizationId: params.actor.organizationId },
        select: { id: true, currentBriefVersionId: true },
      });
      // A project of another organization is indistinguishable from one that
      // does not exist — the same rule as everywhere else.
      if (!project?.currentBriefVersionId) throw new GenerationRefusal("PROJETO_NAO_ELEGIVEL");

      const run = await tx.generationRun.create({
        data: {
          siteProjectId: project.id,
          briefVersionId: project.currentBriefVersionId,
          provider: "cursor",
          status: "PENDENTE",
          requestedById: params.actor.userId,
          requestJson: JSON.stringify(body),
        },
        select: { id: true },
      });

      // **This conditional update is the lock.** Two concurrent transactions
      // read the same `BRIEFING_PRONTO`, but only one still finds it there when
      // it writes; the loser gets zero rows and is refused by the state. No
      // application lock, no queue ordering, no dependence on when the consumer
      // wakes.
      //
      // The list of eligible states is asked of the state machine rather than
      // written out here, because a second copy of it is how the two diverge.
      const { count } = await tx.siteProject.updateMany({
        where: {
          id: project.id,
          organizationId: params.actor.organizationId,
          status: { in: statesWithTransitionTo("GERANDO") },
        },
        data: { status: "GERANDO" },
      });
      if (count === 0) throw new GenerationRefusal("PROJETO_NAO_ELEGIVEL");

      const job = await enqueue(tx, {
        organizationId: params.actor.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: run.id,
          siteProjectId: project.id,
        },
      });

      return {
        // Only allowlisted fields reach the stored response, so a later caller
        // with the same key is answered with ids and nothing else.
        response: { generationRunId: run.id, jobId: job.id },
        result: { generationRunId: run.id, jobId: job.id },
      };
    },
  );

  return {
    generationRunId: outcome.response.generationRunId!,
    jobId: outcome.response.jobId!,
    executed: outcome.executed,
  };
}
