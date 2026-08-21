import { z } from "zod";

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(hostname: string): boolean {
  if (PRIVATE_HOSTS.has(hostname.toLowerCase())) return true;
  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
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
