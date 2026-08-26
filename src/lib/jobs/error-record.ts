import {
  describeErrorForStorage,
  formatStoredError,
  type StoredError,
} from "@/lib/provisioning/error-record";

import { buildJobReasonMessage, isJobRefusal } from "./reasons";

/**
 * What may be written into `Job.lastError`.
 *
 * The column is read by whoever opens the queue screen, and it survives longer
 * than any log line, so it gets the same treatment `SiteProvisioning.lastError`
 * already gets: nothing is copied. A stored message is rebuilt from a closed
 * reason plus fields this application produced, and an error that carries no
 * reason keeps none of its text — not here, not in the response, not in the log.
 *
 * `instanceof` alone would not be enough even for our own classes: several of
 * them accept arbitrary strings, so a provider response reaches a column simply
 * by being wrapped on the way out. Only the reason is trusted, and the message
 * is built from it.
 */
export function describeJobError(
  error: unknown,
  options: { step?: string; log?: (line: string) => void } = {},
): StoredError {
  if (isJobRefusal(error)) {
    return {
      code: error.reason,
      message: buildJobReasonMessage(error.reason, error.details),
    };
  }

  // Provisioning refusals, authorization failures and everything unrecognised
  // are already handled there, including the correlation id and the log line
  // that carries no part of the original.
  return describeErrorForStorage(error, options);
}

export { formatStoredError };
export type { StoredError };
