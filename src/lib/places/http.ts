export type FetchRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Controlled fetch with exponential backoff for 429/5xx/timeouts.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 25000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);

      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) return res;
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : baseDelayMs * 2 ** attempt;
        await sleep(delay, opts.signal);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      lastError = err;
      if (attempt === retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt, opts.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry failed");
}
