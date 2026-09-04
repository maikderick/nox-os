/**
 * How long a job waits after a real failure.
 *
 * Full jitter: `random(0, min(teto, base · 2^n))`. The randomness is not
 * decoration. Exponential backoff alone synchronises — a provider that fails
 * for everyone at once gets every job back at exactly the same later moment,
 * and the retry storm reproduces the outage it was meant to survive. Spreading
 * the whole interval, not a fraction of it, is what breaks the convoy.
 *
 * Waiting is not failing, so none of this applies to `deferJob`: an agent that
 * is still running is not a provider that refused.
 */

export const BACKOFF_BASE_SECONDS = 30;
export const BACKOFF_CEILING_SECONDS = 15 * 60;

/** The interval the delay is drawn from, for a job that has failed `attempts` times. */
export function backoffCeilingSeconds(attempts: number): number {
  const exponent = Math.max(0, attempts);
  // `2 ** 40` would overflow the intent long before the number: cap first.
  if (exponent > 20) return BACKOFF_CEILING_SECONDS;
  return Math.min(BACKOFF_CEILING_SECONDS, BACKOFF_BASE_SECONDS * 2 ** exponent);
}

/**
 * The delay itself.
 *
 * `random` is injectable so a test can assert the interval rather than sample
 * it — a distribution is not something a test suite should be checking by
 * running the thing five hundred times.
 */
export function backoffSeconds(attempts: number, random: () => number = Math.random): number {
  return Math.floor(random() * backoffCeilingSeconds(attempts));
}
