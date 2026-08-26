import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { JobRefusal } from "./reasons";

/**
 * "Was this already asked for?", answered before any work begins.
 *
 * The order is the whole design. The key is **reserved first**, in its own
 * committed transaction, and only then is the work run. A key derived from
 * something the work itself creates arrives too late: two concurrent callers
 * would derive two different keys and both would do the work, which is exactly
 * the duplicate the mechanism exists to prevent.
 *
 * So a caller supplies the key, this reserves it, and whoever loses the
 * reservation is told what happened to the winner rather than being allowed to
 * try again.
 */

/**
 * What kind of thing the work does, and therefore what an expired reservation
 * means.
 *
 * A reservation expires when the process that made it died before writing a
 * response. What may be done about that depends entirely on what the work
 * touches, and there is no way to guess it after the fact — which is why the
 * caller declares it up front and the default is the most restrictive one.
 */
export const SIDE_EFFECTS = [
  /** Our own writes, in our own database. Expiring authorises taking over. */
  "LOCAL",
  /** The provider can be asked what exists for this key. Consult, then decide. */
  "EXTERNO_RECONCILIAVEL",
  /** Nothing can rule out an effect. Expiring authorises nothing. */
  "EXTERNO_AMBIGUO",
] as const;

export type SideEffect = (typeof SIDE_EFFECTS)[number];

export function isSideEffect(value: unknown): value is SideEffect {
  return typeof value === "string" && (SIDE_EFFECTS as readonly string[]).includes(value);
}

/**
 * What may be written into `responseJson`.
 *
 * An allowlist, for the same reason `Job.payloadJson` has one: the stored
 * response is read back and returned to a later caller verbatim, so anything
 * that reaches it is something this application will repeat on request. A
 * provider's error object serialised "just to be helpful" would be served back
 * for as long as the key lives.
 */
export const RESPONSE_FIELDS = [
  "generationRunId",
  "siteProjectId",
  "siteRevisionId",
  "reservationId",
  "jobId",
  "status",
] as const;

export type IdempotentResponse = Partial<Record<(typeof RESPONSE_FIELDS)[number], string>>;

const MAX_VALUE_LENGTH = 128;

function encodeResponse(response: IdempotentResponse): string {
  const entries = Object.entries(response).filter(([, value]) => value !== undefined);

  for (const [field, value] of entries) {
    if (!(RESPONSE_FIELDS as readonly string[]).includes(field)) {
      throw new JobRefusal("PAYLOAD_INVALIDO");
    }
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_VALUE_LENGTH) {
      throw new JobRefusal("PAYLOAD_INVALIDO");
    }
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

/** Drops anything unrecognised, so an older row cannot serve a newer field. */
export function decodeResponse(raw: string): IdempotentResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JobRefusal("PAYLOAD_INVALIDO");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JobRefusal("PAYLOAD_INVALIDO");
  }

  const response: IdempotentResponse = {};
  for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(RESPONSE_FIELDS as readonly string[]).includes(field)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    response[field as keyof IdempotentResponse] = value;
  }
  return response;
}

/** A stable fingerprint of the request body, for detecting a reused key. */
export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null), "utf8").digest("hex");
}

/** Default life of a reservation: long enough for the work, short enough to matter. */
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

export type WithIdempotencyParams = {
  /** Mandatory. The key is the client's; the scope of it is never global. */
  organizationId: string;
  /** `generation.request` and friends. Keys of one scope never meet another's. */
  scope: string;
  key: string;
  requestHash: string;
  sideEffect: SideEffect;
  ttlMs?: number;
  /**
   * Asks the provider what exists for this key.
   *
   * Only consulted for `EXTERNO_RECONCILIAVEL`, and only when a reservation has
   * expired. Returning a response means "it happened, here is what came of it";
   * returning null means "it demonstrably did not happen", and the work may run
   * again.
   */
  reconcile?: () => Promise<IdempotentResponse | null>;
};

export type IdempotentOutcome<T> = {
  /** False when the stored response was served instead of running the work. */
  executed: boolean;
  response: IdempotentResponse;
  /** Present only when the work actually ran. */
  result?: T;
};

type Reservation = { id: string; taken: boolean };

/**
 * Takes the key, or finds out who has it.
 *
 * The insert is what decides — not a read followed by a write, which two
 * callers can both pass. Losing the insert is normal and is answered by
 * examining the row that won.
 */
async function reserve(
  params: WithIdempotencyParams,
  expiresAt: Date,
): Promise<Reservation | null> {
  try {
    const row = await prisma.idempotencyKey.create({
      data: {
        organizationId: params.organizationId,
        scope: params.scope,
        key: params.key,
        requestHash: params.requestHash,
        sideEffect: params.sideEffect,
        expiresAt,
      },
      select: { id: true },
    });
    return { id: row.id, taken: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * Runs `work` at most once per key, and answers every other caller from what is
 * recorded.
 *
 * The four ways a second caller can arrive:
 *
 *   * the key is **finished** — the stored response is served, and nothing runs;
 *   * the key is **live and not expired** — someone is working on it right now,
 *     so this caller is told to wait rather than starting a second one;
 *   * the key is **live and expired** — the process that held it died, and what
 *     happens next is decided entirely by `sideEffect`;
 *   * the key exists with a **different body** — a reused key, which is a
 *     caller bug and is refused every time, whatever its state.
 */
export async function withIdempotency<T>(
  params: WithIdempotencyParams,
  work: () => Promise<{ response: IdempotentResponse; result?: T }>,
): Promise<IdempotentOutcome<T>> {
  if (!params.organizationId) throw new JobRefusal("PAYLOAD_INVALIDO");
  if (!isSideEffect(params.sideEffect)) throw new JobRefusal("PAYLOAD_INVALIDO");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMs ?? DEFAULT_TTL_MS));

  const mine = await reserve(params, expiresAt);
  if (mine) return runAndRecord(params, mine.id, work);

  const existing = await prisma.idempotencyKey.findUniqueOrThrow({
    where: {
      organizationId_scope_key: {
        organizationId: params.organizationId,
        scope: params.scope,
        key: params.key,
      },
    },
  });

  // Checked before anything else, and regardless of state. A key that means two
  // different requests is broken whether the first one finished or not.
  if (existing.requestHash !== params.requestHash) {
    throw new JobRefusal("CORPO_DIVERGENTE");
  }

  if (existing.status === "CONCLUIDA" && existing.responseJson) {
    return { executed: false, response: decodeResponse(existing.responseJson) };
  }

  const expired = existing.expiresAt.getTime() <= now.getTime();
  if (!expired) {
    // Someone is working on it. Not an error, and not an invitation to help.
    throw new JobRefusal("CHAVE_EM_ANDAMENTO");
  }

  return takeOverExpired(params, existing, work);
}

async function runAndRecord<T>(
  params: WithIdempotencyParams,
  id: string,
  work: () => Promise<{ response: IdempotentResponse; result?: T }>,
): Promise<IdempotentOutcome<T>> {
  let produced;
  try {
    produced = await work();
  } catch (error) {
    // The reservation is released rather than left to expire: the work failed
    // outright, so there is nothing to protect and no reason to make the caller
    // wait out a TTL before trying again. Failing to release is survivable —
    // the row expires — so a cleanup failure never masks the real error.
    await prisma.idempotencyKey
      .delete({ where: { id } })
      .catch(() => undefined);
    throw error;
  }

  // Past this point the work has already happened, and the reservation is the
  // only record that it did.
  //
  // So if the response fails the allowlist — a caller returning a field nobody
  // declared — the key is deliberately **not** released. Releasing it would let
  // the next call run the work a second time, and the work is exactly the thing
  // that cannot be repeated. The reservation stands, unanswered, and expiring
  // hands it to the machinery built for "we do not know what happened": taken
  // over for `LOCAL`, sent to a person for anything external.
  const responseJson = encodeResponse(produced.response);

  await prisma.idempotencyKey.update({
    where: { id },
    data: { status: "CONCLUIDA", responseJson },
  });

  return { executed: true, response: decodeResponse(responseJson), result: produced.result };
}

/**
 * What to do with a reservation whose owner never came back.
 *
 * This is where `sideEffect` earns its place. The row looks identical in all
 * three cases — live, expired, no response — and the correct action is
 * completely different in each.
 */
async function takeOverExpired<T>(
  params: WithIdempotencyParams,
  existing: { id: string; sideEffect: string },
  work: () => Promise<{ response: IdempotentResponse; result?: T }>,
): Promise<IdempotentOutcome<T>> {
  const declared = isSideEffect(existing.sideEffect) ? existing.sideEffect : "EXTERNO_AMBIGUO";

  if (declared === "LOCAL") {
    // Our writes, our database, and they either committed or they did not.
    // Nothing outside can have been half-done, so taking over is safe.
    await prisma.idempotencyKey.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS)) },
    });
    return runAndRecord(params, existing.id, work);
  }

  if (declared === "EXTERNO_RECONCILIAVEL") {
    // The provider can be asked. Ask, and decide from the answer — never from
    // the silence.
    const found = params.reconcile ? await params.reconcile() : null;
    if (found) {
      const responseJson = encodeResponse(found);
      await prisma.idempotencyKey.update({
        where: { id: existing.id },
        data: { status: "CONCLUIDA", responseJson },
      });
      return { executed: false, response: decodeResponse(responseJson) };
    }
    if (!params.reconcile) {
      // Declared reconcilable and given no way to reconcile. That is not a
      // licence to repeat: it is the ambiguous case wearing the wrong label.
      throw new JobRefusal("EFEITO_EXTERNO_AMBIGUO");
    }
    await prisma.idempotencyKey.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS)) },
    });
    return runAndRecord(params, existing.id, work);
  }

  // `EXTERNO_AMBIGUO`. Expiring proves the process died; it proves nothing
  // about what the provider did before it died. Repeating here is precisely
  // the blind repetition the whole phase exists to avoid, so this goes to a
  // person instead.
  throw new JobRefusal("EFEITO_EXTERNO_AMBIGUO");
}
