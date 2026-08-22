import { describe, expect, it } from "vitest";
import {
  createDemoSlug,
  demoExpiryDate,
  generateDemoLandingContent,
  isDemoLandingExpired,
} from "../../src/lib/demo-landing";
import {
  demoLandingContentSchema,
  parseDemoLandingContent,
  updateDemoLandingSchema,
} from "../../src/lib/demo-landing-schema";

const lead = {
  name: "Restaurante Dom Pedro",
  category: "Restaurantes",
  address: "Rua Central, 10",
  neighborhood: "Centro",
  city: "Fortaleza",
  state: "CE",
  phoneE164: "+5585999999999",
};

describe("automatic demo landing generator", () => {
  it("uses confirmed lead fields and leaves services empty", () => {
    const content = generateDemoLandingContent(lead);

    expect(content.headline).toContain(lead.name);
    expect(content.subheadline).toContain(lead.category);
    expect(content.subheadline).toContain(lead.city);
    expect(content.benefits).toContain(`Bairro informado: ${lead.neighborhood}`);
    expect(content.services).toEqual([]);
    expect(demoLandingContentSchema.safeParse(content).success).toBe(true);
  });

  it("does not manufacture ratings, prices, hours or services", () => {
    const content = generateDemoLandingContent({
      name: "Clínica Exemplo",
      category: "Clínicas",
      city: "Recife",
    });
    const generatedText = JSON.stringify(content).toLowerCase();

    expect(content.services).toEqual([]);
    expect(generatedText).not.toMatch(/avaliaç|estrela|r\$|preço|horário|segunda a sexta/);
    expect(generatedText).not.toContain("fortaleza");
  });

  it("selects a deterministic visual preset from the category", () => {
    const restaurant = generateDemoLandingContent(lead);
    const automotive = generateDemoLandingContent({
      ...lead,
      category: "Oficina automotiva",
    });

    expect(restaurant.primaryColor).toBe("#dc2626");
    expect(automotive.primaryColor).toBe("#334155");
    expect(restaurant).toEqual(generateDemoLandingContent(lead));
  });

  it("keeps malformed or oversized provider fields inside the public schema", () => {
    const content = generateDemoLandingContent({
      name: "  ",
      category: "x".repeat(2_000),
      city: "y".repeat(2_000),
    });

    expect(content.headline).toBe("Conheça Negócio local");
    expect(demoLandingContentSchema.safeParse(content).success).toBe(true);
  });
});

describe("demo slug and expiry", () => {
  it("builds an opaque slug with a sanitized business prefix", () => {
    expect(createDemoSlug("Clínica São João!", "abcdef0123456789")).toBe(
      "clinica-sao-joao-abcdef0123456789",
    );
  });

  it("uses fresh strong entropy by default", () => {
    const first = createDemoSlug("Empresa");
    const second = createDemoSlug("Empresa");
    expect(first).toMatch(/^empresa-[a-f0-9]{24}$/);
    expect(second).not.toBe(first);
  });

  it("calculates and detects the validity window", () => {
    const start = new Date("2026-08-21T12:00:00.000Z");
    const expiry = demoExpiryDate(14, start);
    expect(expiry.toISOString()).toBe("2026-09-04T12:00:00.000Z");
    expect(isDemoLandingExpired(expiry, new Date("2026-09-04T11:59:59.999Z"))).toBe(false);
    expect(isDemoLandingExpired(expiry, new Date("2026-09-04T12:00:00.000Z"))).toBe(true);
  });
});

describe("demo content validation", () => {
  it("rejects invalid colors and extra content fields", () => {
    const content = generateDemoLandingContent(lead);
    expect(
      demoLandingContentSchema.safeParse({ ...content, primaryColor: "red" }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({ ...content, reviews: ["5 estrelas"] }).success,
    ).toBe(false);
  });

  it("rejects malformed stored JSON", () => {
    expect(() => parseDemoLandingContent("{oops")).toThrow(/formato inválido/);
  });

  it("requires at least one editable field in PATCH", () => {
    expect(updateDemoLandingSchema.safeParse({}).success).toBe(false);
    expect(updateDemoLandingSchema.safeParse({ status: "APPROVED" }).success).toBe(true);
    expect(updateDemoLandingSchema.safeParse({ status: "PUBLISHED" }).success).toBe(false);
  });
});
