import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Normalizes Brazilian (or international) phone numbers to E.164.
 * Returns null when the number cannot be parsed reliably.
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "BR",
): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

/**
 * Checks that a value is both syntactically E.164 and a valid telephone number.
 * Keeping this separate from normalization prevents a malformed stored value from
 * producing a broken wa.me URL.
 */
export function isValidPhoneE164(value: string | null | undefined): value is string {
  if (!value || !/^\+[1-9]\d{7,14}$/.test(value)) return false;

  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed?.isValid() && parsed.format("E.164") === value);
}

/**
 * Whether a number is a mobile line, and so plausibly reachable on WhatsApp.
 *
 * The bundled metadata is the "min" set, which carries no line types, so this
 * answers for Brazil only — where a mobile subscriber number is nine digits
 * beginning with 9 — and answers "no" for anything else rather than guessing.
 * A wrong "yes" would put a landline behind a WhatsApp button on a client's
 * site; a wrong "no" only means the operator types the number themselves.
 */
export function isMobilePhone(raw: string | null | undefined): boolean {
  const e164 = normalizePhoneE164(raw);
  if (!e164) return false;

  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed || parsed.country !== "BR") return false;

  const national = parsed.nationalNumber;
  return national.length === 11 && national.startsWith("9", 2);
}

/** Digits only for wa.me links (no leading +). */
export function phoneDigitsForWaMe(e164: string): string {
  return e164.replace(/\D/g, "");
}
