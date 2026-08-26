import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { JobRefusal } from "./reasons";

/**
 * "Was this already asked for?", answered before any work begins.
 *
 * Two ideas hold the whole thing up.
 *
 * **The reservation comes first, and it is durable.** A key derived from
 * something the work itself creates arrives too late: two concurrent callers
 * would derive two different keys and both would work, which is the duplicate
 * the mechanism exists to prevent. So the client supplies the key, an insert
 * decides who has it, and everyone else is told what happened to the winner.
 *
 * **Possession is a token, not a timestamp.** Renewing `expiresAt` is not
 * taking over: two callers finding the same expired key would both renew and
 * both run. Taking over writes a new `ownerToken` under a condition the
 * database evaluates, so exactly one wins — and finishing checks that token, so
 * an executor whose place was taken cannot overwrite the result of whoever took
 * it.
 *
 * Every instant here comes from `NOW()`. Comparing a database `expiresAt`
 * against this process's clock would be two clocks agreeing by luck, and the
 * thing they decide is whether it is safe to run something twice.
 */

/**
 * What kind of thing the work does, and therefore what an expired or failed
 * reservation allows.
 *
 * There is no way to infer this after the fact — the row looks identical in
 * every case — so the caller declares it up front, and the default is the most
 * restrictive one.
 */
export const SIDE_EFFECTS = [
  /** Our own writes, in our own transaction. They committed or they did not. */
  "LOCAL",
  /** The provider can be asked what exists for this key. Consult, then decide. */
  "EXTERNO_RECONCILIAVEL",
  /** Nothing can rule out an effect. Expiring authorises nothing at all. */
  "EXTERNO_AMBIGUO",
] as const;

export type SideEffect = (typeof SIDE_EFFECTS)[number];

export function isSideEffect(value: unknown): value is SideEffect {
  return typeof value === "string" && (SIDE_EFFECTS as readonly string[]).includes(value);
}

/**
 * What may be written into `responseJson`.
 *
 * An allowlist, because the stored response is served back **verbatim** to a
 * later caller: anything that reaches it is something this application will
 * repeat on request for as long as the key lives. A provider's error object
 * serialised "to be helpful" would become a permanent endpoint.
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

/**
 * Sorts object keys so that the same request hashes the same however it was
 * serialised.
 *
 * The decision, stated because it could reasonably go the other way: **key
 * order does not matter, array order does**. `{a, b}` and `{b, a}` are the same
 * request — JSON object order is not semantic, and it varies between clients,
 * library versions and proxies, so treating it as meaningful would produce 409s
 * for requests that are identical. `[1, 2]` and `[2, 1]` are different
 * requests: a list's order is chosen by whoever wrote it.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v)]),
  );
}

/** A stable fingerprint of the request body, for detecting a reused key. */
export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(body ?? null)), "utf8").digest("hex");
}

/** Default life of a reservation: long enough for the work, short enough to matter. */
export const DEFAULT_TTL_SECONDS = 15 * 60;

type BaseParams = {
  /** Mandatory. The key is the client's; the scope of it is never global. */
  organizationId: string;
  /** `generation.request` and friends. Keys of one scope never meet another's. */
  scope: string;
  key: string;
  requestHash: string;
  ttlSeconds?: number;
};

export type LocalParams = BaseParams & { sideEffect: "LOCAL" };

export type ExternalParams = BaseParams & {
  sideEffect: "EXTERNO_RECONCILIAVEL" | "EXTERNO_AMBIGUO";
  /**
   * Asks the provider what exists for this key.
   *
   * Consulted before any re-execution of an `EXTERNO_RECONCILIAVEL` key.
   * Returning a response means "it happened, here is what came of it";
   * returning null means "it demonstrably did not happen".
   */
  reconcile?: () => Promise<IdempotentResponse | null>;
};

export type WithIdempotencyParams = LocalParams | ExternalParams;

export type Produced<T> = { response: IdempotentResponse; result?: T };

/**
 * Local work runs **inside** the transaction that finishes the key.
 *
 * That is what closes the window where a `GenerationRun` exists and the
 * response recording it does not: the domain writes, the allowlist check and
 * the completion are one commit, so a failure at any point takes all of them.
 */
export type LocalWork<T> = (tx: Prisma.TransactionClient) => Promise<Produced<T>>;
export type ExternalWork<T> = () => Promise<Produced<T>>;

export type IdempotentOutcome<T> = {
  /** False when the recorded response was served instead of running the work. */
  executed: boolean;
  response: IdempotentResponse;
  /** Present only when the work actually ran. */
  result?: T;
};

type StoredKey = {
  id: string;
  requestHash: string;
  status: string;
  sideEffect: string;
  responseJson: string | null;
  ownerToken: string | null;
  /** Computed by PostgreSQL, never by this process. */
  expirada: boolean;
};

type Held = { id: string; token: string };

// --- the four statements that decide anything -------------------------------

/**
 * Takes the key if nobody has it.
 *
 * `ON CONFLICT DO NOTHING` rather than catching a unique violation: losing is
 * an ordinary outcome here, not an exception, and the row that won has to be
 * read either way.
 */
async function reserve(params: WithIdempotencyParams, ttl: number): Promise<Held | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IdempotencyKey"
      ("id", "organizationId", "scope", "key", "requestHash", "sideEffect",
       "status", "ownerToken", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${params.organizationId}, ${params.scope}, ${params.key},
       ${params.requestHash}, ${params.sideEffect}, 'EM_ANDAMENTO', ${token},
       NOW() + make_interval(secs => ${ttl}::double precision), NOW(), NOW())
    ON CONFLICT ("organizationId", "scope", "key") DO NOTHING
    RETURNING "id"
  `;
  const row = rows[0];
  return row ? { id: row.id, token } : null;
}

/** Reads the row, with the expiry question answered by the database. */
async function load(params: WithIdempotencyParams): Promise<StoredKey | null> {
  const rows = await prisma.$queryRaw<StoredKey[]>`
    SELECT "id", "requestHash", "status", "sideEffect", "responseJson", "ownerToken",
           ("expiresAt" <= NOW()) AS "expirada"
      FROM "IdempotencyKey"
     WHERE "organizationId" = ${params.organizationId}
       AND "scope" = ${params.scope}
       AND "key" = ${params.key}
  `;
  return rows[0] ?? null;
}

/**
 * Takes over an expired reservation — or finds that someone else just did.
 *
 * The condition is evaluated by PostgreSQL against its own clock, in the same
 * statement that writes the new token. There is no window between deciding and
 * taking, which is the entire difference from renewing `expiresAt` and hoping.
 */
async function takeOver(params: WithIdempotencyParams, ttl: number): Promise<Held | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "IdempotencyKey"
       SET "ownerToken" = ${token},
           "expiresAt" = NOW() + make_interval(secs => ${ttl}::double precision),
           "updatedAt" = NOW()
     WHERE "organizationId" = ${params.organizationId}
       AND "scope" = ${params.scope}
       AND "key" = ${params.key}
       AND "status" = 'EM_ANDAMENTO'
       AND "expiresAt" <= NOW()
    RETURNING "id"
  `;
  const row = rows[0];
  return row ? { id: row.id, token } : null;
}

type Writer = Pick<Prisma.TransactionClient, "$executeRaw">;

/** Records the answer, but only for whoever still holds the key. */
async function conclude(db: Writer, held: Held, responseJson: string): Promise<boolean> {
  const changed = await db.$executeRaw`
    UPDATE "IdempotencyKey"
       SET "status" = 'CONCLUIDA',
           "responseJson" = ${responseJson},
           "ownerToken" = NULL,
           "updatedAt" = NOW()
     WHERE "id" = ${held.id}
       AND "ownerToken" = ${held.token}
       AND "status" = 'EM_ANDAMENTO'
  `;
  return changed === 1;
}

/** Gives the key back, but only if we still hold it. */
async function release(held: Held): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "IdempotencyKey"
     WHERE "id" = ${held.id}
       AND "ownerToken" = ${held.token}
       AND "status" = 'EM_ANDAMENTO'
  `;
}

/** Hands the key to a person, durably, and only if we still hold it. */
async function sendToConciliation(held: Held): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "IdempotencyKey"
       SET "status" = 'CONCILIACAO',
           "ownerToken" = NULL,
           "updatedAt" = NOW()
     WHERE "id" = ${held.id}
       AND "ownerToken" = ${held.token}
       AND "status" = 'EM_ANDAMENTO'
  `;
}

/** Lets an expired external key be taken over immediately, under possession. */
async function expireNow(held: Held): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "IdempotencyKey"
       SET "expiresAt" = NOW(), "updatedAt" = NOW()
     WHERE "id" = ${held.id}
       AND "ownerToken" = ${held.token}
       AND "status" = 'EM_ANDAMENTO'
  `;
}

// --- the execution paths ----------------------------------------------------

/**
 * Local work, its response and the completion of the key: one transaction.
 *
 * Losing possession is discovered by `conclude` finding no row, and it throws —
 * which rolls the domain writes back. An executor whose place was taken leaves
 * nothing behind, which is the only honest outcome: its work was superseded
 * before it finished.
 */
async function runLocal<T>(
  held: Held,
  work: LocalWork<T>,
): Promise<IdempotentOutcome<T>> {
  let responseJson = "";
  let produced: Produced<T>;

  try {
    produced = await prisma.$transaction(async (tx) => {
      const output = await work(tx);
      // Inside the transaction on purpose: a response that fails the allowlist
      // takes the domain writes with it instead of leaving an orphan entity.
      responseJson = encodeResponse(output.response);
      if (!(await conclude(tx, held, responseJson))) {
        throw new JobRefusal("POSSE_PERDIDA");
      }
      return output;
    });
  } catch (error) {
    // The transaction rolled back, so nothing local happened, and the key may
    // be released — conditionally, so a lost possession releases nothing.
    // `POSSE_PERDIDA` is the one case that must not: the key belongs to
    // someone else now, and the condition already refuses it.
    await release(held).catch(() => undefined);
    throw error;
  }

  return { executed: true, response: decodeResponse(responseJson), result: produced.result };
}

/**
 * External work, which cannot be undone by rolling anything back.
 *
 * The key is never deleted here. Work that threw proves the process failed; it
 * proves nothing about what the provider did first, and deleting the key would
 * turn the next call into a fresh attempt at whatever may already have
 * happened.
 */
async function runExternal<T>(
  params: ExternalParams,
  held: Held,
  work: ExternalWork<T>,
): Promise<IdempotentOutcome<T>> {
  let produced: Produced<T>;
  try {
    produced = await work();
  } catch (error) {
    if (params.sideEffect === "EXTERNO_RECONCILIAVEL") {
      // Still protected, and takeable at once — but the next decision has to go
      // through `reconcile` before it may run anything.
      await expireNow(held).catch(() => undefined);
    } else {
      // Ambiguous: durably a person's problem, never a repeat.
      await sendToConciliation(held).catch(() => undefined);
    }
    throw error;
  }

  // A response that fails the allowlist does **not** release the key: the work
  // already happened, and releasing would authorise repeating the one thing
  // that cannot be repeated. The key stands unanswered and expires into the
  // machinery for "we do not know what happened".
  const responseJson = encodeResponse(produced.response);

  if (!(await conclude(prisma, held, responseJson))) {
    throw new JobRefusal("POSSE_PERDIDA");
  }

  return { executed: true, response: decodeResponse(responseJson), result: produced.result };
}

// --- the entry point --------------------------------------------------------

export function withIdempotency<T>(
  params: LocalParams,
  work: LocalWork<T>,
): Promise<IdempotentOutcome<T>>;
export function withIdempotency<T>(
  params: ExternalParams,
  work: ExternalWork<T>,
): Promise<IdempotentOutcome<T>>;
export async function withIdempotency<T>(
  params: WithIdempotencyParams,
  work: LocalWork<T> | ExternalWork<T>,
): Promise<IdempotentOutcome<T>> {
  if (!params.organizationId) throw new JobRefusal("PAYLOAD_INVALIDO");
  if (!isSideEffect(params.sideEffect)) throw new JobRefusal("PAYLOAD_INVALIDO");

  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const mine = await reserve(params, ttl);
  if (mine) return execute(params, mine, work);

  const existing = await load(params);
  if (!existing) {
    // Lost the insert and the row is already gone — a concurrent release. The
    // caller simply asks again rather than being told something false.
    throw new JobRefusal("CHAVE_EM_ANDAMENTO");
  }

  // Checked first, and regardless of state. A key that means two different
  // requests is broken whether the first one finished or not.
  if (existing.requestHash !== params.requestHash) {
    throw new JobRefusal("CORPO_DIVERGENTE");
  }

  if (existing.status === "CONCLUIDA" && existing.responseJson) {
    return { executed: false, response: decodeResponse(existing.responseJson) };
  }

  if (existing.status === "CONCILIACAO") {
    // Persisted, not in flight. No ordinary call gets past this.
    throw new JobRefusal("CHAVE_EM_CONCILIACAO");
  }

  if (!existing.expirada) {
    // Someone is working on it. Not an error, and not an invitation to help.
    throw new JobRefusal("CHAVE_EM_ANDAMENTO");
  }

  return takeOverExpired(params, existing, work, ttl);
}

function execute<T>(
  params: WithIdempotencyParams,
  held: Held,
  work: LocalWork<T> | ExternalWork<T>,
): Promise<IdempotentOutcome<T>> {
  return params.sideEffect === "LOCAL"
    ? runLocal(held, work as LocalWork<T>)
    : runExternal(params, held, work as ExternalWork<T>);
}

/**
 * What to do with a reservation whose owner never came back.
 *
 * The declared effect of the **stored** row decides, not the caller's — a
 * caller arriving with a different declaration does not get to reclassify work
 * someone else started.
 */
async function takeOverExpired<T>(
  params: WithIdempotencyParams,
  existing: StoredKey,
  work: LocalWork<T> | ExternalWork<T>,
  ttl: number,
): Promise<IdempotentOutcome<T>> {
  const declared = isSideEffect(existing.sideEffect) ? existing.sideEffect : "EXTERNO_AMBIGUO";

  if (declared === "EXTERNO_AMBIGUO") {
    // Expiring proves the process died. It proves nothing about the provider,
    // so this never becomes a repeat — and it is recorded durably rather than
    // being rediscovered by every subsequent caller.
    const held = await takeOver(params, ttl);
    if (held) await sendToConciliation(held).catch(() => undefined);
    throw new JobRefusal("EFEITO_EXTERNO_AMBIGUO");
  }

  const held = await takeOver(params, ttl);
  if (!held) {
    // Someone else took it in the moment between reading and acting. That is
    // the race this whole design exists to lose safely.
    throw new JobRefusal("CHAVE_EM_ANDAMENTO");
  }

  if (declared === "LOCAL") {
    // Our writes, our transaction: they committed or they did not, and nothing
    // outside can be half-done. Taking over is safe.
    return runLocal(held, work as LocalWork<T>);
  }

  // `EXTERNO_RECONCILIAVEL`. Ask before deciding — never decide from silence.
  const reconcile = (params as ExternalParams).reconcile;
  if (!reconcile) {
    // Declared reconcilable and given no way to reconcile. That is not a
    // licence to repeat; it is the ambiguous case wearing the wrong label.
    await sendToConciliation(held).catch(() => undefined);
    throw new JobRefusal("EFEITO_EXTERNO_AMBIGUO");
  }

  const found = await reconcile();
  if (found) {
    const responseJson = encodeResponse(found);
    if (!(await conclude(prisma, held, responseJson))) {
      throw new JobRefusal("POSSE_PERDIDA");
    }
    return { executed: false, response: decodeResponse(responseJson) };
  }

  return runExternal(params as ExternalParams, held, work as ExternalWork<T>);
}
