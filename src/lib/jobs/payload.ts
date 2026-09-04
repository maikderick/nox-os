import { JobRefusal } from "./reasons";

/**
 * What a job payload may carry: identifiers this application produced, and
 * nothing else.
 *
 * The payload is read back by a handler that then acts on a provider, so it is
 * an input path like any other. An allowlist of field names is the cheap part;
 * the point is that no value from a provider response is ever put in one — a
 * branch name and a token match the same character class, and "it is just a
 * string we got back" is how the first one becomes the second.
 */
export const JOB_PAYLOAD_FIELDS = [
  "generationRunId",
  "siteProjectId",
  "siteRevisionId",
  "reservationId",
  "commitSha",
] as const;

export type JobPayloadField = (typeof JOB_PAYLOAD_FIELDS)[number];

export type JobPayload = Partial<Record<JobPayloadField, string>>;

/** Ids here are cuid or sha shaped. The bound is a sanity check, not a parser. */
const MAX_VALUE_LENGTH = 128;

function isAllowedField(key: string): key is JobPayloadField {
  return (JOB_PAYLOAD_FIELDS as readonly string[]).includes(key);
}

export function encodeJobPayload(payload: JobPayload): string {
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined);

  for (const [key, value] of entries) {
    if (!isAllowedField(key)) throw new JobRefusal("PAYLOAD_INVALIDO");
    if (typeof value !== "string") throw new JobRefusal("PAYLOAD_INVALIDO");
    if (value.length === 0 || value.length > MAX_VALUE_LENGTH) {
      throw new JobRefusal("PAYLOAD_INVALIDO");
    }
  }

  // Sorted so the same payload always serialises the same way — a stored row is
  // then comparable to a freshly built one without parsing it.
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

/**
 * Reads a stored payload back, dropping anything that is not on the allowlist.
 *
 * Dropping rather than throwing is deliberate: a row written by an older
 * version of this code must not make a job permanently unrunnable, and the
 * handler asks for the fields it needs anyway.
 */
export function decodeJobPayload(raw: string): JobPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new JobRefusal("PAYLOAD_INVALIDO");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JobRefusal("PAYLOAD_INVALIDO");
  }

  const payload: JobPayload = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isAllowedField(key)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    payload[key] = value;
  }
  return payload;
}

/** Reads one required field, refusing rather than handing a handler undefined. */
export function requirePayloadField(payload: JobPayload, field: JobPayloadField): string {
  const value = payload[field];
  if (!value) throw new JobRefusal("PAYLOAD_INVALIDO");
  return value;
}
