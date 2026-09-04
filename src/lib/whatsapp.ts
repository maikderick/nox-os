import { isValidPhoneE164, phoneDigitsForWaMe } from "./phone";

export function buildWhatsAppLink(e164: string, message: string): string {
  if (!isValidPhoneE164(e164)) {
    throw new Error("Telefone E.164 invalido para WhatsApp.");
  }
  const digits = phoneDigitsForWaMe(e164);
  const text = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${text}`;
}

export function renderWhatsAppTemplate(
  template: string,
  vars: { businessName: string; sellerName: string },
): string {
  return template
    .replaceAll("{{businessName}}", vars.businessName)
    .replaceAll("{{sellerName}}", vars.sellerName);
}

export type OptInStatus = "unknown" | "pending" | "verified" | "refused";

export function canOpenWhatsApp(opts: {
  optInStatus: OptInStatus | string;
  doNotContact: boolean;
  phoneE164: string | null | undefined;
  suppressed: boolean;
}): { allowed: boolean; reason?: string } {
  if (opts.doNotContact) {
    return { allowed: false, reason: "Lead marcado como Não contatar." };
  }
  if (opts.suppressed) {
    return { allowed: false, reason: "Número na lista de supressão." };
  }
  if (!opts.phoneE164) {
    return { allowed: false, reason: "Telefone E.164 indisponível." };
  }
  if (!isValidPhoneE164(opts.phoneE164)) {
    return {
      allowed: false,
      reason: "Telefone inválido. Corrija o número para o formato E.164 (ex.: +5581999999999).",
    };
  }
  if (opts.optInStatus !== "verified") {
    return {
      allowed: false,
      reason: "WhatsApp bloqueado até opt-in verified.",
    };
  }
  return { allowed: true };
}
