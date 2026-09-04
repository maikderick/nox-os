import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz/dal";
import { authorized } from "@/lib/authz/route";
import { z } from "zod";
import {
  getStockPhotoConfig,
  searchStockPhotos,
  StockPhotoError,
  stockPhotoLabelForCategory,
  stockPhotoQueryForCategory,
  type StockPhotoErrorCode,
} from "@/lib/stock-photos";

const ERROR_STATUS: Record<StockPhotoErrorCode, number> = {
  not_configured: 503,
  timeout: 504,
  rate_limited: 429,
  upstream: 502,
  invalid_response: 502,
};

const querySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(5).default(1),
});

/**
 * Best-effort throttle so a single signed-in session cannot burn the provider
 * quota. Serverless instances do not share it, which is acceptable: the provider
 * enforces the real ceiling.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const recentRequests = new Map<string, number[]>();

function withinRateLimit(userId: string, now: number): boolean {
  const window = (recentRequests.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  );
  if (window.length >= RATE_MAX_REQUESTS) {
    recentRequests.set(userId, window);
    return false;
  }
  window.push(now);
  recentRequests.set(userId, window);
  return true;
}

export const GET = authorized(async (req: Request) => {
  const actor = await requirePermission("lead:write");

  const config = getStockPhotoConfig();
  if (!config.configured) {
    const error = new StockPhotoError("not_configured");
    return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    page: url.searchParams.get("page") ?? 1,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!withinRateLimit(actor.userId, Date.now())) {
    return NextResponse.json(
      { error: "Muitas buscas seguidas. Aguarde um minuto.", code: "rate_limited" },
      { status: 429 },
    );
  }

  const category = parsed.data.category ?? "";
  const query = parsed.data.q ?? stockPhotoQueryForCategory(category);
  const altLabel = stockPhotoLabelForCategory(category);

  try {
    const photos = await searchStockPhotos({
      query,
      altLabel,
      perPage: 12,
      page: parsed.data.page,
    });
    return NextResponse.json({ photos, query });
  } catch (cause) {
    const error =
      cause instanceof StockPhotoError ? cause : new StockPhotoError("upstream");
    console.error(`[stock-photos] falha ${error.code}`);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: ERROR_STATUS[error.code] },
    );
  }
});
