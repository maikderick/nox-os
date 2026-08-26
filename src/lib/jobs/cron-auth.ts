import { timingSafeEqual } from "node:crypto";

import { AuthorizationError } from "@/lib/authz/errors";

/**
 * Who may wake the consumer.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. That header is the
 * only thing separating a scheduled invocation from anyone on the internet
 * making the factory run work, so it is checked before anything else happens.
 *
 * Two decisions worth stating:
 *
 *   * **no secret configured means no cron.** The tempting alternative — treat
 *     an unset secret as "not deployed yet, let it through" — turns a missing
 *     environment variable into an open endpoint, and missing environment
 *     variables are the most ordinary deployment mistake there is.
 *
 *   * **the comparison is constant time.** The secret is compared against
 *     attacker-supplied input on a public endpoint; `===` on strings leaks its
 *     length and its matching prefix through timing, and there is no reason to
 *     pay that when the fix is one function call.
 */

export function hasCronCredential(request: Request): boolean {
  return request.headers.get("authorization") !== null;
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on differing lengths, which would leak the length
  // through the exception. Compare the digests' fixed-size buffers instead by
  // padding to the longer of the two.
  const size = Math.max(left.length, right.length);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}

/**
 * Refuses unless the request carries the configured cron secret.
 *
 * Throws `AuthorizationError` with 401, the same shape the rest of the
 * application uses, so the route needs no special case.
 */
export function assertCronRequest(request: Request): void {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    throw new AuthorizationError("O agendador não está configurado nesta instalação.", 401);
  }

  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

  if (!equals(offered, configured)) {
    throw new AuthorizationError("Credencial do agendador inválida.", 401);
  }
}
