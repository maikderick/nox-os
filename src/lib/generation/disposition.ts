import { CreditRefusal } from "@/lib/credits/reasons";
import { AgentIsolationRefusal } from "@/lib/codegen/isolation";
import { JobRefusal } from "@/lib/jobs/reasons";
import {
  IntegrationDisabledError,
  IntegrationModeUnsupportedError,
} from "@/lib/providers/errors";

import { GenerationRefusal } from "./reasons";

/**
 * What happened to the attempt to start, as a closed domain written **before**
 * the call.
 *
 * This is the column the whole phase turns on. A remote effect cannot be
 * rolled back, so the decision "may this be called again?" cannot be taken by
 * reading an error message afterwards — the process that would read it is
 * exactly the process that may have died. So the disposition is written first,
 * and the answer is read out of the database by whoever comes next.
 *
 * | Disposition | What happened | What a retry may do |
 * | --- | --- | --- |
 * | `NAO_TENTADO` | nothing left here | call |
 * | `EM_TENTATIVA` | written **before** the call; the process may have died with it in flight | treat as ambiguous |
 * | `SEM_EFEITO_COMPROVADO` | a typed internal error, before the call | call again, **with the same reservation** |
 * | `INICIADO` | `providerRunId` recorded | do not call; go to the poll |
 * | `AMBIGUO` | an unknown error, or an effect that cannot be ruled out | conciliation |
 *
 * `startAttemptedAt` still exists as a timestamp. What it does not do is
 * decide: "there was an attempt" does not separate the three things that
 * matter — did not call, called and did not catch, called and did not find out.
 */

export const START_DISPOSITIONS = [
  "NAO_TENTADO",
  "EM_TENTATIVA",
  "SEM_EFEITO_COMPROVADO",
  "INICIADO",
  "AMBIGUO",
] as const;

export type StartDisposition = (typeof START_DISPOSITIONS)[number];

export function isStartDisposition(value: unknown): value is StartDisposition {
  return typeof value === "string" && (START_DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * Reads a stored value, and reads anything unfamiliar as the strictest one.
 *
 * A row written by a version of this code we do not have is not a row to take
 * chances with: the cost of guessing "safe" is a second paid run.
 */
export function dispositionFromStored(value: unknown): StartDisposition {
  return isStartDisposition(value) ? value : "AMBIGUO";
}

/**
 * The error types that prove nothing left this process.
 *
 * Every one of them is raised by **our own code**, before any byte goes out: a
 * price that is not configured, credit that is not there, a payload that is not
 * ours, a provider that is switched off, an isolation scope that is wrong.
 *
 * The classification looks at the **type**, never at the message. A message is
 * the one part of an error that anything can write — including a provider
 * client that helpfully wrapped a timeout in a sentence containing the word
 * "invalid" — and "we may safely charge for this again" is not a decision to
 * take on a substring match.
 */
const PROVEN_LOCAL_ERRORS = [
  CreditRefusal,
  JobRefusal,
  GenerationRefusal,
  AgentIsolationRefusal,
  IntegrationDisabledError,
  IntegrationModeUnsupportedError,
] as const;

/**
 * Where an error leaves the attempt.
 *
 * A timeout, a socket error, a response nobody understands: all `AMBIGUO`. Not
 * because they are worse errors, but because none of them says whether the
 * provider acted — and the disposition answers only that question.
 */
export function classifyStartError(error: unknown): "SEM_EFEITO_COMPROVADO" | "AMBIGUO" {
  for (const type of PROVEN_LOCAL_ERRORS) {
    if (error instanceof type) return "SEM_EFEITO_COMPROVADO";
  }
  return "AMBIGUO";
}

/** Dispositions from which it is proved that nothing was ever paid for. */
export function provesNothingWasCalled(disposition: StartDisposition): boolean {
  return disposition === "NAO_TENTADO" || disposition === "SEM_EFEITO_COMPROVADO";
}
