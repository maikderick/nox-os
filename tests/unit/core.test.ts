import { describe, expect, it } from "vitest";
import {
  isValidPhoneE164,
  normalizePhoneE164,
  phoneDigitsForWaMe,
} from "../../src/lib/phone";
import { buildWhatsAppLink, canOpenWhatsApp, renderWhatsAppTemplate } from "../../src/lib/whatsapp";
import { distanceKm, roundDistance } from "../../src/lib/distance";
import { scoreOpportunity } from "../../src/lib/score";
import {
  findDuplicate,
  nameSimilarity,
  normalizeDomain,
  normalizeName,
} from "../../src/lib/dedupe";
import { fetchWithRetry } from "../../src/lib/places/http";
import { parseCsvPlaces } from "../../src/lib/places/csv";
import {
  isTemporaryOverpassError,
  OVERPASS_ENDPOINTS,
  OverpassPlacesProvider,
  splitAreaIntoCells,
} from "../../src/lib/places/overpass";
import {
  parseStringArray,
  settingsForClient,
} from "../../src/lib/settings-serialization";
import {
  normalizeImportRadii,
  overpassRetryDelayMs,
} from "../../src/lib/import-service";

describe("settings serialization", () => {
  it("parses a valid JSON string array", () => {
    expect(parseStringArray('["Padarias","Restaurantes"]')).toEqual([
      "Padarias",
      "Restaurantes",
    ]);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseStringArray("not-json")).toEqual([]);
  });

  it("rejects arrays containing non-string values", () => {
    expect(parseStringArray('["Padarias",42]')).toEqual([]);
    expect(parseStringArray('{"category":"Padarias"}')).toEqual([]);
  });

  it("serializes settings for the client without dropping other fields", () => {
    expect(
      settingsForClient({
        id: "singleton",
        brandName: "NOX OS",
        enabledCategories: '["Padarias"]',
      }),
    ).toEqual({
      id: "singleton",
      brandName: "NOX OS",
      enabledCategories: ["Padarias"],
    });
  });
});

describe("import funnel radii", () => {
  it("honors the configured initial and maximum radii", () => {
    expect(normalizeImportRadii([5, 10, 20, 40, 80], 10, 40)).toEqual([10, 20, 40]);
  });

  it("adds custom boundaries and removes invalid or duplicate radii", () => {
    expect(normalizeImportRadii([0, 5, 5, 20, 200], 3, 30)).toEqual([3, 5, 20, 30]);
  });
});

describe("phone E.164 BR", () => {
  it("normalizes mobile with DDD", () => {
    expect(normalizePhoneE164("(11) 98765-4321")).toBe("+5511987654321");
  });
  it("normalizes already international", () => {
    expect(normalizePhoneE164("+55 21 99888-7766")).toBe("+5521998887766");
  });
  it("returns null for invalid", () => {
    expect(normalizePhoneE164("123")).toBeNull();
  });
  it("digits for wa.me", () => {
    expect(phoneDigitsForWaMe("+5511987654321")).toBe("5511987654321");
  });
  it("validates stored E.164 before WhatsApp use", () => {
    expect(isValidPhoneE164("+558132243762")).toBe(true);
    expect(isValidPhoneE164("558132243762")).toBe(false);
    expect(isValidPhoneE164("+55123")).toBe(false);
  });
});

describe("whatsapp link", () => {
  it("builds wa.me without plus", () => {
    const link = buildWhatsAppLink("+5511987654321", "Olá teste");
    expect(link).toBe("https://wa.me/5511987654321?text=Ol%C3%A1%20teste");
  });
  it("rejects malformed stored numbers instead of generating a broken link", () => {
    expect(() => buildWhatsAppLink("5511987654321", "Oi")).toThrow(/E\.164/);
  });
  it("renders template", () => {
    expect(
      renderWhatsAppTemplate("Oi {{businessName}} — {{sellerName}}", {
        businessName: "Padaria X",
        sellerName: "Ana",
      }),
    ).toBe("Oi Padaria X — Ana");
  });
  it("blocks without verified opt-in", () => {
    expect(
      canOpenWhatsApp({
        optInStatus: "pending",
        doNotContact: false,
        phoneE164: "+5511999999999",
        suppressed: false,
      }).allowed,
    ).toBe(false);
  });
  it("allows verified", () => {
    expect(
      canOpenWhatsApp({
        optInStatus: "verified",
        doNotContact: false,
        phoneE164: "+5511999999999",
        suppressed: false,
      }).allowed,
    ).toBe(true);
  });
  it("blocks do-not-contact / suppression", () => {
    expect(
      canOpenWhatsApp({
        optInStatus: "verified",
        doNotContact: true,
        phoneE164: "+5511999999999",
        suppressed: false,
      }).allowed,
    ).toBe(false);
    expect(
      canOpenWhatsApp({
        optInStatus: "verified",
        doNotContact: false,
        phoneE164: "+5511999999999",
        suppressed: true,
      }).allowed,
    ).toBe(false);
  });
  it("blocks malformed phone values with a clear reason", () => {
    const gate = canOpenWhatsApp({
      optInStatus: "verified",
      doNotContact: false,
      phoneE164: "+55123",
      suppressed: false,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/Telefone inválido/);
  });
});

describe("distance", () => {
  it("computes approx SP distance", () => {
    const d = roundDistance(distanceKm(-23.55, -46.63, -23.56, -46.64));
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(3);
  });
});

describe("score", () => {
  it("scores digital gap and reasons", () => {
    const s = scoreOpportunity({
      category: "Restaurantes",
      phoneE164: "+5511999999999",
      distanceKm: 2,
      websiteStatus: "not_reported",
      isActiveHint: true,
      dataFreshDays: 1,
    });
    expect(s.opportunityScore).toBeGreaterThan(50);
    expect(s.reasons).toContain("Site não informado");
    expect(s.reasons).toContain("Telefone comercial");
    expect(s.confidenceScore).toBeGreaterThan(40);
  });
  it("penalizes franchise", () => {
    const a = scoreOpportunity({ category: "Lanchonetes", looksLikeFranchise: false });
    const b = scoreOpportunity({ category: "Lanchonetes", looksLikeFranchise: true });
    expect(b.opportunityScore).toBeLessThan(a.opportunityScore);
    expect(b.reasons).toContain("Possível franquia");
  });
});

describe("dedupe", () => {
  it("matches source+externalId", () => {
    const match = findDuplicate(
      { source: "overpass", externalId: "n/1", name: "A" },
      [{ source: "overpass", externalId: "n/1", name: "A" }],
    );
    expect(match?.reason).toBe("source_external_id");
  });
  it("matches phone", () => {
    const match = findDuplicate(
      { source: "csv", name: "X", phoneE164: "+5511999999999" },
      [{ source: "overpass", name: "Y", phoneE164: "+5511999999999" }],
    );
    expect(match?.reason).toBe("phone_e164");
  });
  it("matches domain", () => {
    const match = findDuplicate(
      { source: "csv", name: "X", website: "https://www.loja.com.br" },
      [{ source: "overpass", name: "Y", website: "http://loja.com.br/page" }],
    );
    expect(match?.reason).toBe("domain");
    expect(normalizeDomain("https://www.loja.com.br")).toBe("loja.com.br");
  });
  it("matches name+geo similarity", () => {
    expect(nameSimilarity("Padaria Central Ltda", "Padaria Central")).toBeGreaterThan(0.8);
    const match = findDuplicate(
      {
        source: "csv",
        name: "Padaria Central Ltda",
        latitude: -23.55,
        longitude: -46.63,
      },
      [
        {
          source: "overpass",
          name: "Padaria Central",
          latitude: -23.55001,
          longitude: -46.63001,
        },
      ],
    );
    expect(match?.reason).toBe("name_geo");
  });
  it("normalizeName strips noise", () => {
    expect(normalizeName("Comércio XYZ Ltda")).toContain("xyz");
  });
});

describe("csv parse", () => {
  it("parses rows", () => {
    const places = parseCsvPlaces(
      "name,category,city,phone\nPadaria Z,Padarias,SP,11999990000\n",
    );
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Padaria Z");
  });
});

describe("overpass cells", () => {
  it("splits large radius", () => {
    const cells = splitAreaIntoCells(-23.55, -46.63, 40, 10);
    expect(cells.length).toBeGreaterThan(1);
  });

  it("uses the current public global instances instead of the retired Kumi hostname", () => {
    expect(OVERPASS_ENDPOINTS).toContain("https://overpass.private.coffee/api/interpreter");
    expect(OVERPASS_ENDPOINTS).toContain(
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    );
    expect(OVERPASS_ENDPOINTS.some((endpoint) => endpoint.includes("kumi.systems"))).toBe(false);
  });

  it("falls back to another instance after an endpoint-specific HTTP 406", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      if (calls.length === 1) return new Response("not acceptable", { status: 406 });
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 123,
              lat: -8.05,
              lon: -34.88,
              tags: { name: "Padaria Teste", shop: "bakery" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await new OverpassPlacesProvider().search({
        area: { lat: -8.05, lng: -34.88, radiusKm: 1 },
        categoryIds: ["food"],
      });
      expect(result.places).toHaveLength(1);
      expect(calls).toHaveLength(2);
      expect(calls[0].headers.get("user-agent")).toContain("NOX-OS-Leads");
      expect(calls[0].headers.has("accept")).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("classifies total 5xx failure as temporary", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;

    try {
      await expect(
        new OverpassPlacesProvider().search({
          area: { lat: -8.05, lng: -34.88, radiusKm: 1 },
          categoryIds: ["food"],
        }),
      ).rejects.toSatisfy(isTemporaryOverpassError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("overpass automatic retry", () => {
  it("uses bounded exponential delays", () => {
    expect(overpassRetryDelayMs(1)).toBe(2_000);
    expect(overpassRetryDelayMs(2)).toBe(4_000);
    expect(overpassRetryDelayMs(10)).toBe(20_000);
  });
});

describe("fetch retry 429", () => {
  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("rate", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithRetry("https://example.test", {}, { retries: 3, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    globalThis.fetch = original;
  });
});
