import { createHash, timingSafeEqual } from "node:crypto";

import { AuthorizationError } from "@/lib/authz/errors";

/**
 * Who may wake the consumer.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. That header is the
 * only thing separating a scheduled invocation from anyone on the internet
 * making the factory run work, so it is checked before anything else happens.
 *
 * Three decisions worth stating:
 *
 *   * **no secret configured means no cron.** The tempting alternative — treat
 *     an unset secret as "not deployed yet, let it through" — turns a missing
 *     environment variable into an open endpoint, and missing environment
 *     variables are the most ordinary deployment mistake there is.
 *
 *   * **the whole header is the secret.** What is compared is the complete
 *     expected string, scheme included, not the token pulled out of it. Parsing
 *     the header first means writing a parser, and a parser is where "`Bearer `
 *     is optional", "extra whitespace is fine" and "any scheme will do" get
 *     added later by someone being helpful. A bare secret with no `Bearer`
 *     prefix is simply a different string, and is refused.
 *
 *   * **the comparison is constant time, over fixed-size values.**
 *     `timingSafeEqual` throws when the buffers differ in length, so comparing
 *     the raw strings would either crash or need padding — and padding is its
 *     own timing question. Hashing both sides first gives two 32-byte buffers
 *     whatever arrived, so length is never observable and the comparison is the
 *     only thing that happens.
 */

const SCHEME = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasCronCredential(request: Request): boolean {
  return request.headers.get("authorization") !== null;
}

/**
 * Refuses unless the request carries exactly the configured cron header.
 *
 * Throws `AuthorizationError` with 401, the same shape the rest of the
 * application uses, so the route needs no special case.
 */
export function assertCronRequest(request: Request): void {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    throw new AuthorizationError("O agendador não está configurado nesta instalação.", 401);
  }

  const offered = request.headers.get("authorization") ?? "";
  const expected = `${SCHEME}${configured}`;

  if (!timingSafeEqual(digest(offered), digest(expected))) {
    throw new AuthorizationError("Credencial do agendador inválida.", 401);
  }
}
