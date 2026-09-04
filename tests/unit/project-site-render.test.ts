import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectSite } from "@/components/sites/project-site";
import { findSlop } from "@/lib/design/anti-slop";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: "2026-09-03T12:00:00.000Z" };
}

function brief(sector: string, overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
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
    ...overrides,
  });
}

function render(sector: string, seed: string, overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ProjectSite, { brief: brief(sector, overrides), seed }),
  );
}

describe("renderizador do site", () => {
  it("não comete nenhuma das regras anti-slop", () => {
    for (const sector of ["Barbearia", "Advocacia", "Pizzaria", "Clínica odontológica", "Pousada"]) {
      const found = findSlop(render(sector, "semente-fixa"));
      expect(found.map((rule) => rule.id), sector).toEqual([]);
    }
  });

  it("aplica a paleta da direção resolvida", () => {
    const html = render("Barbearia", "semente-fixa");
    const direction = resolveArtDirection({ sector: "Barbearia", seed: "semente-fixa" });
    expect(html).toContain(direction.palette.surface);
    expect(html).toContain(direction.palette.ink);
  });

  it("dá visuais diferentes a categorias diferentes", () => {
    const barbearia = render("Barbearia", "s");
    const advocacia = render("Advocacia", "s");
    expect(barbearia).not.toBe(advocacia);

    const dark = resolveArtDirection({ sector: "Barbearia", seed: "s" });
    const light = resolveArtDirection({ sector: "Advocacia", seed: "s" });
    expect(dark.palette.surface).not.toBe(light.palette.surface);
  });

  it("dá visuais diferentes a dois clientes da mesma categoria", () => {
    const seeds = Array.from({ length: 12 }, (_, index) => `projeto-${index}`);
    const rendered = new Set(seeds.map((seed) => render("Barbearia", seed)));
    expect(rendered.size).toBeGreaterThan(1);
  });

  it("é estável: a mesma semente rende o mesmo markup", () => {
    expect(render("Barbearia", "fixa")).toBe(render("Barbearia", "fixa"));
  });

  it("publica o nome e o posicionamento confirmados", () => {
    const html = render("Barbearia", "s");
    expect(html).toContain("Aurora");
    expect(html).toContain("Informações claras e verificadas sobre o negócio.");
  });

  it("não inventa seção sem fato: sem contato confirmado, sem bloco de contato", () => {
    const html = render("Barbearia", "s");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
  });

  it("publica só o canal confirmado", () => {
    const html = render("Barbearia", "s", {
      publicContact: {
        phone: { value: "+5585999998888", source: "CLIENTE" as const, confirmedAt: "2026-09-03T12:00:00.000Z" },
        whatsapp: null, email: null, address: null, coordinates: null,
        openingHours: null, socialLinks: [],
      },
    });
    expect(html).toContain("tel:+5585999998888");
    expect(html).not.toContain("wa.me");
  });

  it("não vaza marca da fábrica para o site do cliente", () => {
    expect(render("Barbearia", "s")).not.toMatch(/NOX|nox-os/i);
  });

  it("dá estrutura de serviços diferente a dispositivos diferentes", () => {
    const withService = {
      services: [{ id: "corte", name: fact("Corte"), summary: fact("Corte na tesoura ou na máquina."),
        body: [fact("Acabamento na navalha.")], relatedIds: [], featured: false }],
    };
    const food = render("Pizzaria", "s", withService);      // menu-leader
    const auto = render("Oficina mecânica", "s", withService); // spec-table
    const law = render("Advocacia", "s", withService);       // bound-spine
    expect(food).toContain("dotted");
    expect(auto).toContain("tabular-nums");
    expect(law).toContain("border-left");
    expect(new Set([food, auto, law]).size).toBe(3);
  });
});
