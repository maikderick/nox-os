import type { Job } from "@prisma/client";

import { type PauseReason, type JobKind } from "./kinds";
import { requirePayloadField, type JobPayload } from "./payload";

/**
 * What a handler is given, and what it may answer.
 *
 * The handler does **not** settle the job. It says what happened and the
 * consumer applies it, which is what makes "every claimed job is settled
 * exactly once" a property of the loop rather than a rule each handler has to
 * remember. A handler that forgot to settle would otherwise leave its job
 * `EM_EXECUCAO` until the lease lapsed, and the queue would look healthy for
 * six minutes at a time.
 */
export type JobContext = {
  job: Job;
  /** Decoded and allowlisted; the raw column is never handed over. */
  payload: JobPayload;
  /** This consumer's identity for the lease. Never a secret. */
  owner: string;

  /**
   * Pushes the lease deadline forward, and answers whether it worked.
   *
   * Long work beats. A handler that stops getting `true` has lost the job to a
   * reclaim and must stop — someone else owns it now.
   */
  heartbeat: () => Promise<boolean>;

  /**
   * Whether this consumer still holds the job.
   *
   * **Ask this immediately before anything with an effect outside the
   * database.** A handler whose lease lapsed mid-run and that calls the
   * provider anyway produces precisely the duplicate the lease exists to
   * prevent, and it produces it at the most expensive possible moment.
   */
  stillOurs: () => Promise<boolean>;
};

/**
 * The five endings, as data.
 *
 * Mirrors `outcomes.ts` one for one; the consumer is the only thing that turns
 * one of these into a write.
 */
export type JobOutcome =
  | { type: "concluido" }
  | { type: "aguardar"; delaySeconds: number }
  | { type: "pausar"; reason: PauseReason; retryAfterSeconds: number }
  | { type: "falha_recuperavel"; error: unknown }
  | { type: "falha_permanente"; error: unknown; as?: "FALHOU" | "CONCILIACAO" };

export type JobHandler = (context: JobContext) => Promise<JobOutcome>;

export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

/**
 * The registry: one entry per kind, and no switch anywhere.
 *
 * Each handler is a thin adapter over a domain function that knows nothing
 * about jobs beyond the outcome it returns. That separation is what makes the
 * chain testable without a queue and the queue testable without the chain — and
 * it is why every one of these is two lines.
 *
 * The handlers are loaded lazily, inside the call. Importing the generation
 * chain at module scope would pull Prisma, the provider registry and the credit
 * ledger into every module that so much as mentions `JobOutcome` — including
 * the pure ones, and including the consumer, whose own tests deliberately pass
 * their handlers in.
 */
export const JOB_HANDLERS: JobHandlers = {
  "generation.start": async (context) => {
    const { startGeneration } = await import("@/lib/generation/start");
    return startGeneration({
      generationRunId: requirePayloadField(context.payload, "generationRunId"),
      // Handed through so the step can ask, immediately before calling the
      // provider, whether this consumer still owns the job.
      stillOurs: context.stillOurs,
    });
  },

  "generation.poll": async (context) => {
    const { pollGeneration } = await import("@/lib/generation/poll");
    return pollGeneration({
      generationRunId: requirePayloadField(context.payload, "generationRunId"),
    });
  },

  "checks.poll": async (context) => {
    const { pollChecks } = await import("@/lib/generation/checks");
    return pollChecks({
      generationRunId: requirePayloadField(context.payload, "generationRunId"),
    });
  },

  "preview.poll": async (context) => {
    const { pollPreview } = await import("@/lib/generation/preview");
    return pollPreview({
      generationRunId: requirePayloadField(context.payload, "generationRunId"),
    });
  },

  "credit.threshold": async (context) => {
    const { watchReservationThreshold } = await import("@/lib/credits/threshold");
    return watchReservationThreshold({
      reservationId: requirePayloadField(context.payload, "reservationId"),
    });
  },
};
