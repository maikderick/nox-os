import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStockPhotoCache,
  getStockPhotoConfig,
  illustrativeAltText,
  isSafeStockPhotoUrl,
  searchStockPhotos,
  stockPhotoLabelForCategory,
  stockPhotoQueryForCategory,
} from "../../src/lib/stock-photos";
import {
  applyStockPhotos,
  fetchDemoStockPhotos,
  type DemoStockPhotos,
} from "../../src/lib/demo-landing-photos";
import { generateDemoLandingContent } from "../../src/lib/demo-landing";
import {
  demoLandingContentSchema,
  parseDemoLandingContent,
  type DemoLandingContent,
} from "../../src/lib/demo-landing-schema";
import { buildDemoAiFacts, mergeDemoAiDraft } from "../../src/lib/demo-landing-ai";

const lead = {
  name: "Padaria Aurora",
  category: "Padaria",
  address: "Rua Central, 10",
  neighborhood: "Centro",
  city: "Fortaleza",
  state: "CE",
  postalCode: "60000-000",
  phoneE164: "+5585999999999",
  socialLinks: "[]",
  website: null,
  latitude: -3.7319,
  longitude: -38.5267,
};

function content(overrides: Partial<DemoLandingContent> = {}): DemoLandingContent {
  return demoLandingContentSchema.parse({ ...generateDemoLandingContent(lead), ...overrides });
}

function pexelsPayload(count: number, overrides: Record<string, unknown>[] = []) {
  return {
    photos: Array.from({ length: count }, (_, index) => ({
      photographer: `Fotógrafo ${index}`,
      photographer_url: `https://www.pexels.com/@fotografo-${index}`,
      src: {
        large2x: `https://images.pexels.com/photos/${index}/foto.jpg`,
        large: `https://images.pexels.com/photos/${index}/foto-large.jpg`,
      },
      ...(overrides[index] ?? {}),
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("category to search term", () => {
  it.each([
    ["Padarias", "bakery interior bread"],
    ["Barbearia masculina", "barbershop interior chair"],
    ["Oficina mecânica", "auto repair shop garage"],
    ["Clínica Odontológica", "modern clinic reception"],
    ["Salão de beleza", "hair salon interior"],
  ])("maps %s to a specific term", (category, expected) => {
    expect(stockPhotoQueryForCategory(category)).toBe(expected);
  });

  it("falls back to a generic term for unknown categories", () => {
    expect(stockPhotoQueryForCategory("Serviços diversos")).toBe(
      "local small business storefront",
    );
    expect(stockPhotoLabelForCategory("Serviços diversos")).toBe("negócio local");
  });

  it("always labels the photo as illustrative", () => {
    expect(illustrativeAltText("padaria", 0)).toBe("Imagem ilustrativa de padaria");
    expect(illustrativeAltText("padaria", 2)).toBe("Imagem ilustrativa de padaria 3");
  });
});

describe("provider URL allowlist", () => {
  it("accepts only HTTPS images from the provider host", () => {
    expect(isSafeStockPhotoUrl("https://images.pexels.com/photos/1/foto.jpg")).toBe(true);
    expect(isSafeStockPhotoUrl("http://images.pexels.com/photos/1/foto.jpg")).toBe(false);
    expect(isSafeStockPhotoUrl("https://evil.example.com/foto.jpg")).toBe(false);
    expect(isSafeStockPhotoUrl("https://images.pexels.com.evil.com/foto.jpg")).toBe(false);
    expect(isSafeStockPhotoUrl("https://user:pass@images.pexels.com/foto.jpg")).toBe(false);
    expect(isSafeStockPhotoUrl("nao-e-url")).toBe(false);
  });
});

describe("provider search", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearStockPhotoCache();
    vi.unstubAllGlobals();
    process.env.PEXELS_API_KEY = "chave-de-teste";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("refuses to call the provider without a key", async () => {
    delete process.env.PEXELS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchStockPhotos({ query: "bakery", altLabel: "padaria" }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getStockPhotoConfig().configured).toBe(false);
  });

  it("never sends the key in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pexelsPayload(1)));
    vi.stubGlobal("fetch", fetchMock);

    await searchStockPhotos({ query: "bakery", altLabel: "padaria" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).not.toContain("chave-de-teste");
    expect((init.headers as Record<string, string>).Authorization).toBe("chave-de-teste");
  });

  it("drops photos hosted anywhere but the provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          pexelsPayload(3, [
            {},
            { src: { large2x: "https://evil.example.com/roubada.jpg" } },
            { src: { large2x: "javascript:alert(1)" } },
          ]),
        ),
      ),
    );

    const photos = await searchStockPhotos({ query: "bakery", altLabel: "padaria" });

    expect(photos).toHaveLength(1);
    expect(photos[0].url).toBe("https://images.pexels.com/photos/0/foto.jpg");
    expect(photos[0].alt).toBe("Imagem ilustrativa de padaria");
    expect(photos[0].credit).toBe("Foto de Fotógrafo 0 via Pexels");
  });

  it.each([
    [429, "rate_limited"],
    [401, "not_configured"],
    [500, "upstream"],
  ])("maps HTTP %s to %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, status)));

    await expect(
      searchStockPhotos({ query: "bakery", altLabel: "padaria" }),
    ).rejects.toMatchObject({ code });
  });

  it("reports a timeout when the request is aborted", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      searchStockPhotos({ query: "bakery", altLabel: "padaria" }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects a malformed provider answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ photos: "nao-e-lista" })));

    await expect(
      searchStockPhotos({ query: "bakery", altLabel: "padaria" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("reuses the cached result for the same term", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pexelsPayload(2)));
    vi.stubGlobal("fetch", fetchMock);

    await searchStockPhotos({ query: "bakery", altLabel: "padaria" });
    await searchStockPhotos({ query: "bakery", altLabel: "padaria" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("applying photos to a demo", () => {
  const stock: DemoStockPhotos = {
    hero: {
      url: "https://images.pexels.com/photos/1/hero.jpg",
      alt: "Imagem ilustrativa de padaria",
      credit: "Foto de Ana via Pexels",
      creditUrl: "https://www.pexels.com/@ana",
    },
    gallery: [
      {
        url: "https://images.pexels.com/photos/2/a.jpg",
        alt: "Imagem ilustrativa de padaria 2",
        credit: "Foto de Bruno via Pexels",
        creditUrl: "https://www.pexels.com/@bruno",
      },
    ],
  };

  it("fills an empty demo and marks every photo as illustrative", () => {
    const applied = applyStockPhotos(content(), stock);

    expect(applied.heroImageUrl).toBe(stock.hero?.url);
    expect(applied.heroImageKind).toBe("stock");
    expect(applied.heroImageCredit).toBe("Foto de Ana via Pexels");
    expect(applied.galleryImages).toHaveLength(1);
    expect(applied.galleryImages[0].kind).toBe("stock");
    expect(demoLandingContentSchema.safeParse(applied).success).toBe(true);
  });

  it("never overwrites photos the reviewer supplied", () => {
    const current = content({
      heroImageUrl: "https://cdn.exemplo.com/oficial.jpg",
      galleryImages: [
        {
          url: "https://cdn.exemplo.com/fachada.jpg",
          alt: "Fachada oficial",
          kind: "official",
          credit: null,
          creditUrl: "",
        },
      ],
    });

    const applied = applyStockPhotos(current, stock);

    expect(applied.heroImageUrl).toBe("https://cdn.exemplo.com/oficial.jpg");
    expect(applied.heroImageKind).toBe("official");
    expect(applied.galleryImages).toEqual(current.galleryImages);
  });

  it("returns the demo untouched when there are no photos", () => {
    const current = content();

    expect(applyStockPhotos(current, { hero: null, gallery: [] })).toBe(current);
  });

  it("keeps the protected snapshot", () => {
    const current = content();

    expect(applyStockPhotos(current, stock).businessSnapshot).toEqual(current.businessSnapshot);
  });
});

describe("photo fetching never breaks generation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearStockPhotoCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("returns no photos when the key is missing", async () => {
    delete process.env.PEXELS_API_KEY;

    await expect(fetchDemoStockPhotos("Padaria")).resolves.toEqual({ hero: null, gallery: [] });
  });

  it("returns no photos when the provider is down", async () => {
    process.env.PEXELS_API_KEY = "chave-de-teste";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(fetchDemoStockPhotos("Padaria")).resolves.toEqual({ hero: null, gallery: [] });
  });

  it("splits the answer into one hero and up to three gallery photos", async () => {
    process.env.PEXELS_API_KEY = "chave-de-teste";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(pexelsPayload(4))));

    const photos = await fetchDemoStockPhotos("Padaria");

    expect(photos.hero?.url).toBe("https://images.pexels.com/photos/0/foto.jpg");
    expect(photos.gallery).toHaveLength(3);
  });
});

describe("compatibility with demos stored before photos existed", () => {
  it("reads legacy images as official, matching how they render today", () => {
    const legacy = JSON.stringify({
      ...content(),
      heroImageUrl: "https://cdn.exemplo.com/antiga.jpg",
      heroImageKind: undefined,
      heroImageCredit: undefined,
      heroImageCreditUrl: undefined,
      galleryImages: [{ url: "https://cdn.exemplo.com/foto.jpg", alt: "Fachada" }],
    });

    const parsed = parseDemoLandingContent(legacy);

    expect(parsed.heroImageKind).toBe("official");
    expect(parsed.heroImageCredit).toBeNull();
    expect(parsed.galleryImages[0]).toEqual({
      url: "https://cdn.exemplo.com/foto.jpg",
      alt: "Fachada",
      kind: "official",
      credit: null,
      creditUrl: "",
    });
  });
});

describe("Claude cannot touch photos", () => {
  it("keeps every image field from the stored demo", () => {
    const current = applyStockPhotos(content(), {
      hero: {
        url: "https://images.pexels.com/photos/1/hero.jpg",
        alt: "Imagem ilustrativa de padaria",
        credit: "Foto de Ana via Pexels",
        creditUrl: "https://www.pexels.com/@ana",
      },
      gallery: [
        {
          url: "https://images.pexels.com/photos/2/a.jpg",
          alt: "Imagem ilustrativa de padaria 2",
          credit: "Foto de Bruno via Pexels",
          creditUrl: "https://www.pexels.com/@bruno",
        },
      ],
    });

    const draft = {
      headline: "Conheça a Padaria Aurora",
      subheadline: "Padaria no Centro, em Fortaleza. Uma página clara e direta.",
      aboutTitle: "Sobre a Padaria Aurora",
      about: "A Padaria Aurora atua na categoria padarias e tem localização informada.",
      factsTitle: "Informações essenciais",
      benefits: ["Categoria: padaria"],
      servicesTitle: "Serviços",
      servicesIntro: "Consulte o estabelecimento para confirmar o que está disponível.",
      services: [],
      galleryTitle: "Uma visão mais completa",
      galleryIntro: "Esta seção foi preparada para receber fotos oficiais ou autorizadas.",
      processTitle: "Como conhecer",
      processIntro: "Use as informações desta demonstração como ponto de partida.",
      processSteps: [
        "Confira a categoria informada.",
        "Verifique a localização informada.",
        "Confirme os detalhes com o estabelecimento.",
      ],
      faqTitle: "Dúvidas frequentes",
      faqs: [],
      contactTitle: "Informações de contato",
      contactText: "Valide os canais informados diretamente com o estabelecimento.",
      finalCtaTitle: "Próximo passo",
      finalCtaText: "Confirme os detalhes diretamente com o estabelecimento.",
      ctaLabel: "Ver informações" as const,
      primaryColor: "#dc2626",
      accentColor: "#f59e0b",
    };

    const { content: merged } = mergeDemoAiDraft({ current, draft });

    expect(merged.heroImageUrl).toBe(current.heroImageUrl);
    expect(merged.heroImageKind).toBe(current.heroImageKind);
    expect(merged.heroImageCredit).toBe(current.heroImageCredit);
    expect(merged.heroImageCreditUrl).toBe(current.heroImageCreditUrl);
    expect(merged.galleryImages).toEqual(current.galleryImages);
    expect(buildDemoAiFacts(current).officialPhotoCount).toBe(1);
  });
});
