import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { demoLanding: { findUnique: mocks.findUnique, update: mocks.update } },
}));

import { GET } from "../../src/app/demo/[slug]/site/route";
import { generateDemoLandingContent } from "../../src/lib/demo-landing";
import { demoLandingContentSchema } from "../../src/lib/demo-landing-schema";

const business = {
  name: "Padaria Aurora",
  category: "Padaria",
  city: "Fortaleza",
  state: "CE",
  phoneE164: "+5585999999999",
  socialLinks: "[]",
  website: null as string | null,
  latitude: -3.7319,
  longitude: -38.5267,
};

function contentJson(builtSiteUrl: string) {
  return JSON.stringify(
    demoLandingContentSchema.parse({
      ...generateDemoLandingContent({ ...business, website: null }),
      builtSiteUrl,
    }),
  );
}

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "demo-1",
    status: "APPROVED",
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    contentJson: contentJson("https://padaria-aurora.lovable.app"),
    business: { website: null },
    ...overrides,
  };
}

const ctx = { params: Promise.resolve({ slug: "padaria-aurora-abc123" }) };
const request = () =>
  new Request("https://nox.example.com/demo/padaria-aurora-abc123/site");

describe("GET /demo/[slug]/site", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(stored());
  });

  it("sends the visitor to the site built elsewhere", async () => {
    const response = await GET(request(), ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://padaria-aurora.lovable.app/");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("stops working once the demo expires, like the preview does", async () => {
    mocks.findUnique.mockResolvedValue(
      stored({ expiresAt: new Date(Date.now() - 86_400_000) }),
    );

    const response = await GET(request(), ctx);

    expect(response.headers.get("location")).toBe(
      "https://nox.example.com/demo/padaria-aurora-abc123",
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } }),
    );
  });

  it("never exposes a draft through the built-site redirect", async () => {
    mocks.findUnique.mockResolvedValue(stored({ status: "DRAFT" }));

    const response = await GET(request(), ctx);

    expect(response.headers.get("location")).toBe(
      "https://nox.example.com/demo/padaria-aurora-abc123",
    );
  });

  it("refuses a lead that turned out to have its own website", async () => {
    mocks.findUnique.mockResolvedValue(
      stored({ business: { website: "https://padaria-aurora.com.br" } }),
    );

    const response = await GET(request(), ctx);

    expect(response.headers.get("location")).toContain("/demo/padaria-aurora-abc123");
  });

  it("falls back to the demo when no site was registered", async () => {
    mocks.findUnique.mockResolvedValue(stored({ contentJson: contentJson("") }));

    const response = await GET(request(), ctx);

    expect(response.headers.get("location")).toContain("/demo/padaria-aurora-abc123");
  });

  it("cannot be turned into an open redirect by a malformed stored value", async () => {
    const tampered = JSON.parse(contentJson("https://ok.example.com")) as Record<string, unknown>;
    tampered.builtSiteUrl = "http://evil.example.com";
    mocks.findUnique.mockResolvedValue(stored({ contentJson: JSON.stringify(tampered) }));

    const response = await GET(request(), ctx);

    expect(response.headers.get("location")).not.toContain("evil.example.com");
  });

  it("falls back when the record does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await GET(request(), ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/demo/padaria-aurora-abc123");
  });
});

describe("built site address validation", () => {
  it("accepts only safe HTTPS addresses", () => {
    const base = generateDemoLandingContent({ ...business, website: null });

    expect(
      demoLandingContentSchema.safeParse({ ...base, builtSiteUrl: "https://ok.example.com" })
        .success,
    ).toBe(true);
    expect(
      demoLandingContentSchema.safeParse({ ...base, builtSiteUrl: "" }).success,
    ).toBe(true);
    expect(
      demoLandingContentSchema.safeParse({ ...base, builtSiteUrl: "http://inseguro.com" })
        .success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({ ...base, builtSiteUrl: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });
});
