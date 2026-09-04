/**
 * The one number every timeout in the queue is measured against.
 *
 * The platform kills the consumer function at this many seconds. Everything
 * that has to outlive a running execution — a lease, an idempotency
 * reservation — is derived from it here rather than chosen independently, so
 * that raising the ceiling cannot quietly leave one of them underneath it.
 *
 * It is not imported by the route: Next requires `maxDuration` to be a literal
 * it can read without evaluating the module. The route carries the literal and
 * a test asserts the two agree, which is the closest thing to a shared constant
 * that the framework allows.
 */
export const FUNCTION_MAX_DURATION_SECONDS = 300;

/**
 * How long a claim is good for.
 *
 * **Above the ceiling, not equal to it.** A consumer may legitimately still be
 * working at the last second of its budget; a lease that expired in that same
 * instant would let a second consumer take the job mid-call, and both would act
 * on the same remote resource — the exact duplicate the lease exists to
 * prevent, produced by the lease itself.
 */
export const DEFAULT_LEASE_SECONDS = FUNCTION_MAX_DURATION_SECONDS + 60;

/**
 * How long an idempotency reservation holds.
 *
 * Fixed, and comfortably above the lease. A reservation shorter than the
 * execution it protects is worse than none: it expires while the work is still
 * running, a second caller takes it over, and the mechanism that exists to
 * prevent duplicate work becomes the thing that schedules it.
 *
 * Fifteen minutes covers a consumer's whole budget several times over, which is
 * the point — the number is not tuned, it is deliberately far away.
 */
export const IDEMPOTENCY_TTL_SECONDS = 15 * 60;
