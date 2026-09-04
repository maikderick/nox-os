import { z } from "zod";
import { isIP } from "node:net";

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(hostname: string): boolean {
  // WHATWG URL preserves brackets around IPv6 hostnames. Normalize before
  // comparing, otherwise `http://[::1]` slips past a check for `::1`.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (PRIVATE_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(host) === 6) {
    if (host === "::" || host === "::1") return true;
    // IPv4-mapped IPv6 is normalized by URL (for example
    // ::ffff:127.0.0.1 becomes ::ffff:7f00:1). Decode it and apply the IPv4
    // policy instead of maintaining a second, incomplete list.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return isPrivateIp(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      );
    }

    const first = Number.parseInt(host.split(":", 1)[0] || "0", 16);
    return (
      (first & 0xfe00) === 0xfc00 || // unique-local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (first & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
      (first & 0xff00) === 0xff00 || // multicast
      host.startsWith("2001:db8:") // documentation-only range
    );
  }

  return false;
}

export const publicHttpUrlSchema = z
  .string()
  .url()
  .refine((u) => {
    try {
      const url = new URL(u);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      if (isPrivateIp(url.hostname)) return false;
      return true;
    } catch {
      return false;
    }
  }, "URL pública HTTP/HTTPS obrigatória");

export type WebsiteAuditResult = {
  status: "ok" | "unavailable" | "not_found" | "blocked" | "skipped";
  checkedAt: string;
  finalUrl?: string;
  statusCode?: number;
  error?: string;
};

/**
 * Lightweight public URL check with SSRF protections.
 * Does not crawl — single HEAD/GET with limits.
 */
export async function auditPublicWebsite(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxRedirects?: number },
): Promise<WebsiteAuditResult> {
  const checkedAt = new Date().toISOString();
  const parsed = publicHttpUrlSchema.safeParse(rawUrl);
  if (!parsed.success) {
    return { status: "blocked", checkedAt, error: "URL bloqueada por política SSRF" };
  }

  const timeoutMs = opts?.timeoutMs ?? 5000;
  const maxRedirects = opts?.maxRedirects ?? 3;
  let current = parsed.data;
  let redirects = 0;

  try {
    while (redirects <= maxRedirects) {
      const nextParsed = publicHttpUrlSchema.safeParse(current);
      if (!nextParsed.success) {
        return { status: "blocked", checkedAt, error: "Redirect para destino inseguro" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "NOX-OS-SiteAudit/1.0" },
      });
      clearTimeout(timer);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { status: "unavailable", checkedAt, statusCode: res.status };
        current = new URL(loc, current).toString();
        redirects += 1;
        continue;
      }

      if (res.status >= 200 && res.status < 400) {
        return { status: "ok", checkedAt, finalUrl: current, statusCode: res.status };
      }
      if (res.status === 404) {
        return { status: "not_found", checkedAt, finalUrl: current, statusCode: 404 };
      }
      return { status: "unavailable", checkedAt, finalUrl: current, statusCode: res.status };
    }
    return { status: "unavailable", checkedAt, error: "Muitos redirects" };
  } catch (err) {
    return {
      status: "unavailable",
      checkedAt,
      error: err instanceof Error ? err.message : "Falha no teste",
    };
  }
}
