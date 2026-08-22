import { z } from "zod";
import { DEMO_STOCK_PHOTO_HOST, isDemoStockPhotoUrl } from "./demo-landing-schema";

/**
 * Only images served from this host are ever accepted. The provider answer is
 * treated as hostile input, exactly like the Claude answer is.
 */
export const PEXELS_IMAGE_HOST = DEMO_STOCK_PHOTO_HOST;
const DEFAULT_PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search";

/**
 * Overridable only through a server environment variable, so a local mock can
 * stand in for the provider. Same trust level as the key itself.
 */
function pexelsSearchUrl(): string {
  const override = process.env.PEXELS_API_URL?.trim();
  return override && /^https?:\/\//i.test(override) ? override : DEFAULT_PEXELS_SEARCH_URL;
}
const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_PER_PAGE = 24;
const MAX_PAGE = 5;

export type StockPhotoErrorCode =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "upstream"
  | "invalid_response";

export class StockPhotoError extends Error {
  readonly code: StockPhotoErrorCode;

  constructor(code: StockPhotoErrorCode, message?: string) {
    super(message ?? STOCK_PHOTO_ERROR_MESSAGES[code]);
    this.name = "StockPhotoError";
    this.code = code;
  }
}

export const STOCK_PHOTO_ERROR_MESSAGES: Record<StockPhotoErrorCode, string> = {
  not_configured:
    "A busca de fotos ilustrativas não está configurada. Defina PEXELS_API_KEY nas variáveis de ambiente da Vercel. A demonstração continua sendo gerada normalmente, com composições visuais.",
  timeout: "O banco de imagens demorou demais para responder. Tente novamente em instantes.",
  rate_limited:
    "O limite de buscas do banco de imagens foi atingido. Aguarde alguns minutos e tente novamente.",
  upstream:
    "O banco de imagens está indisponível no momento. A demonstração continua funcionando sem fotos ilustrativas.",
  invalid_response: "O banco de imagens devolveu uma resposta inesperada. Nenhuma foto foi usada.",
};

export type StockPhotoConfig = {
  configured: boolean;
  timeoutMs: number;
};

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/** Reports availability without ever returning the key itself. */
export function getStockPhotoConfig(): StockPhotoConfig {
  return {
    configured: Boolean(process.env.PEXELS_API_KEY?.trim()),
    timeoutMs: positiveInt(process.env.PEXELS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 30_000),
  };
}

export const isSafeStockPhotoUrl = isDemoStockPhotoUrl;

export type StockPhoto = {
  url: string;
  alt: string;
  credit: string;
  creditUrl: string;
};

const pexelsPhotoSchema = z.object({
  photographer: z.string().trim().max(180).optional(),
  photographer_url: z.string().trim().max(2_000).optional(),
  src: z
    .object({
      large2x: z.string().optional(),
      large: z.string().optional(),
      landscape: z.string().optional(),
    })
    .passthrough(),
});

const pexelsResponseSchema = z.object({
  photos: z.array(pexelsPhotoSchema).default([]),
});

type CategoryQuery = {
  keywords: string[];
  query: string;
  label: string;
};

/**
 * Search terms are English because that is what the provider indexes well; the
 * visible label stays Portuguese because it is rendered on the public page.
 */
const CATEGORY_QUERIES: CategoryQuery[] = [
  {
    keywords: ["padaria", "confeitaria", "doceria", "bolo"],
    query: "bakery interior bread",
    label: "padaria",
  },
  // Listed before the food entries on purpose: "barbearia" contains "bar".
  {
    keywords: ["barbear", "barbeiro"],
    query: "barbershop interior chair",
    label: "barbearia",
  },
  {
    keywords: [
      "restaurante",
      "lanchonete",
      "pizz",
      "comida",
      "alimenta",
      "hamburg",
      "boteco",
      "botequim",
      "choperia",
      "cervejaria",
      "pub",
    ],
    query: "restaurant interior table",
    label: "restaurante",
  },
  { keywords: ["cafeteria", "cafe"], query: "coffee shop interior", label: "cafeteria" },
  {
    keywords: ["salao", "beleza", "cabeleire", "estetica", "manicure"],
    query: "hair salon interior",
    label: "salão de beleza",
  },
  {
    keywords: ["academia", "fitness", "crossfit", "pilates", "esporte", "musculacao"],
    query: "modern gym interior",
    label: "academia",
  },
  { keywords: ["pet", "veterinar", "animal"], query: "pet shop grooming", label: "pet shop" },
  {
    keywords: ["oficina", "automot", "mecanica", "veiculo", "funilaria", "borracharia"],
    query: "auto repair shop garage",
    label: "oficina automotiva",
  },
  {
    keywords: ["escola", "curso", "educa", "ensino", "idioma"],
    query: "classroom learning space",
    label: "escola",
  },
  {
    keywords: ["clinica", "consultorio", "dent", "odonto", "saude", "medic", "fisio"],
    query: "modern clinic reception",
    label: "clínica",
  },
  {
    keywords: ["hotel", "pousada", "hosped", "hostel", "turismo"],
    query: "boutique hotel room lobby",
    label: "hospedagem",
  },
  {
    keywords: ["imobili", "advoc", "contabil", "escritorio", "consultoria", "arquitet"],
    query: "modern office workspace",
    label: "escritório",
  },
  {
    keywords: ["loja", "comercio", "varejo", "roupa", "moda", "boutique", "movei", "eletronic"],
    query: "retail store interior shelves",
    label: "loja",
  },
  {
    keywords: ["mercado", "mercearia", "hortifrut", "quitanda"],
    query: "grocery store aisle",
    label: "mercado",
  },
  {
    keywords: ["floricultura", "flores", "jardin", "paisag"],
    query: "flower shop arrangement",
    label: "floricultura",
  },
  {
    keywords: ["lavanderia", "limpeza", "higieniza"],
    query: "laundry service interior",
    label: "lavanderia",
  },
  {
    keywords: ["construc", "reforma", "materiais", "marcenaria", "serralher"],
    query: "construction materials workshop",
    label: "construção",
  },
];

const FALLBACK_QUERY: CategoryQuery = {
  keywords: [],
  query: "local small business storefront",
  label: "negócio local",
};

function normalizeCategory(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase();
}

function categoryQueryFor(category: string): CategoryQuery {
  const normalized = normalizeCategory(category);
  return (
    CATEGORY_QUERIES.find((entry) =>
      entry.keywords.some((keyword) => normalized.includes(keyword)),
    ) ?? FALLBACK_QUERY
  );
}

/** English search term for a lead category. */
export function stockPhotoQueryForCategory(category: string): string {
  return categoryQueryFor(category).query;
}

/** Portuguese label used in the visible alt text of an illustrative photo. */
export function stockPhotoLabelForCategory(category: string): string {
  return categoryQueryFor(category).label;
}

export function illustrativeAltText(label: string, index: number): string {
  const suffix = index > 0 ? ` ${index + 1}` : "";
  return `Imagem ilustrativa de ${label}${suffix}`.slice(0, 180);
}

type CacheEntry = { photos: StockPhoto[]; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** Best effort only: every serverless instance keeps its own copy. */
function readCache(key: string, now: number): StockPhoto[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.photos;
}

export function clearStockPhotoCache(): void {
  cache.clear();
}

function toStockPhoto(
  photo: z.infer<typeof pexelsPhotoSchema>,
  altText: string,
): StockPhoto | null {
  const candidate = photo.src.large2x ?? photo.src.landscape ?? photo.src.large ?? "";
  if (!isSafeStockPhotoUrl(candidate)) return null;

  const photographer = photo.photographer?.trim();
  const creditUrl = (photo.photographer_url ?? "").trim();

  return {
    url: new URL(candidate).href,
    alt: altText,
    credit: photographer ? `Foto de ${photographer} via Pexels`.slice(0, 180) : "Foto via Pexels",
    creditUrl: /^https:\/\//i.test(creditUrl) ? creditUrl : "",
  };
}

export type SearchStockPhotosParams = {
  query: string;
  altLabel: string;
  perPage?: number;
  page?: number;
};

/** One provider round trip, host-checked and shaped for the demo content schema. */
export async function searchStockPhotos(params: SearchStockPhotosParams): Promise<StockPhoto[]> {
  const config = getStockPhotoConfig();
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!config.configured || !apiKey) throw new StockPhotoError("not_configured");

  const query = params.query.trim().slice(0, 120);
  if (!query) throw new StockPhotoError("invalid_response");

  const perPage = Math.min(Math.max(params.perPage ?? 12, 1), MAX_PER_PAGE);
  const page = Math.min(Math.max(params.page ?? 1, 1), MAX_PAGE);
  const cacheKey = `${query}::${perPage}::${page}::${params.altLabel}`;
  const now = Date.now();

  const cached = readCache(cacheKey, now);
  if (cached) return cached;

  const url = new URL(pexelsSearchUrl());
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("orientation", "landscape");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new StockPhotoError("timeout");
    }
    throw new StockPhotoError("upstream");
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) throw new StockPhotoError("rate_limited");
  if (response.status === 401 || response.status === 403) {
    throw new StockPhotoError("not_configured");
  }
  if (!response.ok) throw new StockPhotoError("upstream");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StockPhotoError("invalid_response");
  }

  const parsed = pexelsResponseSchema.safeParse(payload);
  if (!parsed.success) throw new StockPhotoError("invalid_response");

  const photos = parsed.data.photos.flatMap((photo, index) => {
    const mapped = toStockPhoto(photo, illustrativeAltText(params.altLabel, index));
    return mapped ? [mapped] : [];
  });

  cache.set(cacheKey, { photos, expiresAt: now + CACHE_TTL_MS });
  return photos;
}
