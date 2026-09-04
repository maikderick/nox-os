import { describe, expect, it } from "vitest";
import {
  classifyWebsite,
  hasOwnWebsite,
  isLeadEligibleByWebsite,
  normalizeWebsiteDomain,
} from "../../src/lib/website";

describe("website classification", () => {
  it.each([undefined, null, "", "  ", "-", "sem site", "Não informado"])(
    "treats %s as no reported website",
    (value) => {
      expect(classifyWebsite(value)).toMatchObject({ kind: "none", hasOwnWebsite: false });
      expect(isLeadEligibleByWebsite(value)).toBe(true);
    },
  );

  it.each([
    "empresa.com.br",
    "www.empresa.com.br/contato",
    "HTTPS://EMPRESA.COM.BR/Produtos",
    "//empresa.com.br",
    "https://loja.github.io",
    "https://empresa.wixsite.com/inicio",
  ])("recognizes an owned site: %s", (value) => {
    const result = classifyWebsite(value);
    expect(result.kind).toBe("owned");
    expect(result.hasOwnWebsite).toBe(true);
    expect(result.normalizedUrl).toMatch(/^https?:\/\//);
    expect(isLeadEligibleByWebsite(value)).toBe(false);
  });

  it.each([
    ["instagram.com/minhaempresa", "social"],
    ["https://m.facebook.com/minhaempresa", "social"],
    ["https://wa.me/5511999999999", "social"],
    ["https://api.whatsapp.com/send?phone=5511999999999", "social"],
    ["tiktok.com/@minhaempresa", "social"],
    ["linkedin.com/company/minhaempresa", "social"],
    ["https://linktr.ee/minhaempresa", "link_hub"],
    ["https://beacons.ai/minhaempresa", "link_hub"],
    ["https://maps.app.goo.gl/abc123", "directory"],
    ["https://www.google.com/maps/place/Empresa", "directory"],
    ["https://www.ifood.com.br/delivery/empresa", "directory"],
    ["https://www.tripadvisor.com.br/Restaurant_Review-x", "directory"],
  ] as const)("keeps a platform page eligible: %s", (value, kind) => {
    const result = classifyWebsite(value);
    expect(result.kind).toBe(kind);
    expect(result.hasOwnWebsite).toBe(false);
    expect(result.normalizedUrl).not.toBeNull();
    expect(isLeadEligibleByWebsite(value)).toBe(true);
  });

  it("matches platform domains only at a hostname boundary", () => {
    expect(hasOwnWebsite("https://instagram.com.exemplo.com.br")).toBe(true);
    expect(hasOwnWebsite("https://fake-linktr.ee.exemplo.com")).toBe(true);
  });

  it.each([
    "contato@empresa.com.br",
    "javascript:alert(1)",
    "http://localhost:3000",
    "http://192.168.0.10",
    "empresa",
    "https://dominio_invalido.com",
  ])("does not exclude a lead for invalid/non-public input: %s", (value) => {
    expect(classifyWebsite(value)).toMatchObject({ kind: "invalid", hasOwnWebsite: false });
  });

  it("normalizes owned domains for deduplication", () => {
    expect(normalizeWebsiteDomain(" 'HTTPS://WWW2.Loja.COM.BR/catalogo#top', ")).toBe(
      "loja.com.br",
    );
    expect(normalizeWebsiteDomain("https://instagram.com/loja")).toBeNull();
  });
});
