import type { Job } from "@prisma/client";

import { type PauseReason, type JobKind } from "./kinds";
import { type JobPayload } from "./payload";

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
 * The registry, empty in this phase.
 *
 * Nothing enqueues a real job until the request route exists, so an empty
 * registry cannot be reached by anything the application does. The handlers
 * arrive with the steps they run — generation in commit 12, the observers in
 * commit 14, the credit threshold in commit 9 — and each one registers itself
 * here rather than the consumer growing a switch.
 */
export const JOB_HANDLERS: JobHandlers = {};
