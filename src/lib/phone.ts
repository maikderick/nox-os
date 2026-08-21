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

/** Digits only for wa.me links (no leading +). */
export function phoneDigitsForWaMe(e164: string): string {
  return e164.replace(/\D/g, "");
}
