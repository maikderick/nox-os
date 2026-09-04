import { isValidPhoneE164, normalizePhoneE164, phoneDigitsForWaMe } from "@/lib/phone";

/**
 * Settings ship with bracketed placeholders ("[SEU NOME]") until the operator
 * fills them in. The public site must never print one of those.
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

export function publicValue(value: string | null | undefined): string | null {
  return isPlaceholder(value) ? null : value!.trim();
}

/** A wa.me link for the studio's own number, or null when there is none. */
export function whatsappLink(rawPhone: string | null | undefined, message: string): string | null {
  const candidate = publicValue(rawPhone);
  if (!candidate) return null;
  const e164 = isValidPhoneE164(candidate) ? candidate : normalizePhoneE164(candidate);
  if (!e164) return null;
  return `https://wa.me/${phoneDigitsForWaMe(e164)}?text=${encodeURIComponent(message)}`;
}

export function isHttpUrl(value: string | null | undefined): value is string {
  const candidate = publicValue(value);
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
