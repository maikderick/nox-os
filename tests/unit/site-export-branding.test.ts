import { describe, expect, it } from "vitest";

import { resolveArtDirection } from "@/lib/design/art-direction";
import { siteBriefV2Schema, type SiteBriefV2 } from "@/lib/site-factory/brief-schema";
import { buildSiteContentSnapshot } from "@/lib/site-factory/site-export";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function briefFor(sector: string): SiteBriefV2 {
  return siteBriefV2Schema.parse({
    schemaVersion: 2,
    businessName: fact("Aurora"), sector: fact(sector), city: fact("Fortaleza"),
    objective: fact("Apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas da região que procuram este tipo de serviço."),
    positioning: fact("Informações claras e verificadas sobre o negócio."),
    differentiators: [], desiredSections: ["Início", "Contato"],
    visualDirection: fact("Sóbrio e legível."), notes: null, services: [],
    publicContact: {
      phone: null, whatsapp: null, email: null, address: null,
      coordinates: null, openingHours: null, socialLinks: [],
    },
    metaDescription: null,
  });
}

describe("branding do snapshot", () => {
  it("vem da direção, não de um literal", () => {
    const seed = "cmtm2yp9u0004zpc3r7jgufvr";
    const snapshot = buildSiteContentSnapshot({
      brief: briefFor("Barbearia"), siteUrl: "https://exemplo.com.br", seed,
      privacy: { controllerName: "Aurora", updatedAt: "2026-09-03T12:00:00.000Z", sections: [] },
    }) as { branding: Record<string, string> };

    const direction = resolveArtDirection({ sector: "Barbearia", seed });
    expect(snapshot.branding.surfaceColor).toBe(direction.palette.surface);
    expect(snapshot.branding.textColor).toBe(direction.palette.ink);
    expect(snapshot.branding.accentColor).toBe(direction.palette.accent);
    expect(snapshot.branding.primaryColor).not.toBe("#1d4ed8");
  });

  it("respeita o enum do contrato", () => {
    for (const sector of ["Barbearia", "Advocacia", "Pizzaria", "Pousada", "Academia"]) {
      const snapshot = buildSiteContentSnapshot({
        brief: briefFor(sector), siteUrl: "https://exemplo.com.br", seed: "s",
        privacy: { controllerName: "X", updatedAt: "2026-09-03T12:00:00.000Z", sections: [] },
      }) as { branding: Record<string, string> };

      expect(["sans", "serif"]).toContain(snapshot.branding.fontFamily);
      expect(["none", "sm", "md", "lg"]).toContain(snapshot.branding.radius);
      for (const key of ["primaryColor", "accentColor", "surfaceColor", "textColor"]) {
        expect(snapshot.branding[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
