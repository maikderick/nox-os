import "server-only";

import {
  environmentForcesDisabled,
  type IntegrationProvider,
} from "@/lib/integrations/modes";
import { getEffectiveMode } from "@/lib/integrations/settings-service";

import { type JobKind } from "./kinds";

/**
 * The brake, asked once per job, before the handler runs.
 *
 * `NOX_INTEGRATIONS=disabled` stops all outbound traffic for the whole
 * installation, and an organization can switch a single provider off on its
 * own. Either way the answer for a job that depends on that provider is the
 * same: **do not run it, and do not punish it**.
 *
 * That distinction is the entire point of this file. A braked job has not
 * failed — nobody refused it, nothing was tried — so it must not spend an
 * attempt, must not record an error, and must not walk toward its dead letter.
 * The brake being on for a fortnight has to leave the queue exactly as it found
 * it, ready to run the moment it comes off.
 */

/**
 * Which provider each kind needs before it can do anything.
 *
 * Declared per kind rather than discovered inside each handler: the brake has
 * to be answerable *before* the handler is entered, and a handler that decides
 * for itself is a handler that can forget to.
 */
export const PROVIDER_BY_KIND: Record<JobKind, IntegrationProvider | null> = {
  /** Calls the generation agent. */
  "generation.start": "cursor",
  "generation.poll": "cursor",
  /** Reads check runs from the repository host. */
  "checks.poll": "github",
  /** Reads the deployment from the hosting provider. */
  "preview.poll": "vercel",
  /** Money and clocks, both ours. Nothing outbound. */
  "credit.threshold": null,
};

/**
 * How long a braked job waits before asking again.
 *
 * Five minutes, and deliberately unrelated to the failure backoff: this is not
 * a retry. Nothing went wrong, so there is nothing to back off from — the job
 * is simply asking whether the situation changed, and it asks at a steady,
 * boring rate whether the brake has been on for one minute or for a month.
 */
export const PAUSE_RETRY_SECONDS = 300;

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "FREIO_GLOBAL" | "INTEGRACAO_DESLIGADA" };

/**
 * Whether this job may run right now.
 *
 * The two refusals are told apart on purpose. `FREIO_GLOBAL` is an operator
 * having stopped the whole installation; `INTEGRACAO_DESLIGADA` is one
 * organization's provider being off. They look identical in the queue and are
 * fixed in completely different places, so the paused job says which.
 */
export async function checkJobGate(params: {
  kind: JobKind;
  organizationId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GateVerdict> {
  const provider = PROVIDER_BY_KIND[params.kind];

  // No provider, no brake. Credit thresholds keep running with everything
  // switched off — they release reservations and watch deadlines, which is
  // exactly the work an installation with its integrations off still needs.
  if (provider === null) return { allowed: true };

  if (environmentForcesDisabled(params.env ?? process.env)) {
    return { allowed: false, reason: "FREIO_GLOBAL" };
  }

  const mode = await getEffectiveMode(params.organizationId, provider);
  if (mode === "DESLIGADO") {
    return { allowed: false, reason: "INTEGRACAO_DESLIGADA" };
  }

  return { allowed: true };
}
