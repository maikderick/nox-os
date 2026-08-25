import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { CLAIM_RULE_IDS, findClaimRisks } from "@/lib/content-integrity";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";
import {
  buildSiteContentSnapshot,
  canonicalJsonStringify,
  hashSiteContent,
  SiteExportError,
} from "@/lib/site-factory/site-export";

/**
 * Contract test between two independent parsers.
 *
 * The NOX OS does not import `@nox/site-kit` — the server and the generated
 * sites have to ship on their own schedules. What keeps them honest is this:
 * the kit exports a versioned JSON Schema and canonical fixtures into
 * `contracts/site-kit/`, and everything the NOX OS produces is validated
 * against that copy here. Drift fails a test instead of a client's site.
 *
 * Refresh the artifacts with `npm run export:artifacts` in the nox-site-kit
 * repository whenever the contract changes.
 */

const contractsDir = resolve(process.cwd(), "contracts/site-kit");

function readArtifact<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(contractsDir, name), "utf8")) as T;
}

const contentSchema = readArtifact<Record<string, unknown>>("site-content.schema.json");
const exampleSnapshot = readArtifact<Record<string, unknown>>("site-content.example.json");
const minimalSnapshot = readArtifact<Record<string, unknown>>("site-content.minimal.json");
const publishedHashes = readArtifact<Record<string, string>>("hashes.json");
const publishedRules = readArtifact<{
  schemaVersion: number;
  rules: { id: string; label: string; pattern: string }[];
}>("fabrication-rules.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateContent = ajv.compile(contentSchema);

function explain(): string {
  return (validateContent.errors ?? [])
    .map((error) => `${error.instancePath || "(raiz)"} ${error.message}`)
    .join("\n  ");
}

const CONFIRMED_AT = "2026-08-25T12:00:00.000-03:00";

function fact(value: string) {
  return { value, source: "OPERADOR" as const, confirmedAt: CONFIRMED_AT };
}

function brief(overrides: Partial<Record<string, unknown>> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 1,
    businessName: fact("Oficina Demonstração NOX"),
    sector: fact("Manutenção residencial"),
    city: fact("São Paulo"),
    objective: fact(
      "Apresentar os serviços de manutenção residencial e receber contatos por telefone.",
    ),
    audience: fact("Moradores e pequenos comércios da região central."),
    positioning: fact(
      "Serviços de manutenção residencial planejados e executados por equipe própria, com atendimento agendado.",
    ),
    services: [fact("Reparos hidráulicos"), fact("Instalações elétricas")],
    differentiators: [fact("Atendimento agendado")],
    desiredSections: ["inicio", "sobre", "servicos", "contato"],
    visualDirection: fact("Visual limpo, com foco em leitura e contraste alto."),
    notes: null,
    ...overrides,
  });
}

const privacy = {
  controllerName: "Oficina Demonstração NOX",
  contactEmail: "privacidade@exemplo-demonstracao.test",
  updatedAt: CONFIRMED_AT,
  sections: [
    {
      heading: "Dados que tratamos",
      body: ["Tratamos apenas os dados enviados voluntariamente pelo formulário de contato."],
    },
  ],
};

const business = {
  name: "Oficina Demonstração NOX",
  category: "Manutenção residencial",
  address: "Rua da Demonstração, 100",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  postalCode: "01000-000",
  phoneE164: "+5511900000000",
  socialLinks: ["https://instagram.com/exemplo-demonstracao"],
  latitude: -23.5505,
  longitude: -46.6333,
};

describe("the artifacts published by the site-kit", () => {
  it("target the schema version this server exports", () => {
    expect(publishedRules.schemaVersion).toBe(1);
    expect(exampleSnapshot.schemaVersion).toBe(1);
  });

  it("accept their own example and minimal fixtures", () => {
    expect(validateContent(exampleSnapshot), explain()).toBe(true);
    expect(validateContent(minimalSnapshot), explain()).toBe(true);
  });

  it("canonicalise exactly the way this server does", () => {
    // Same bytes on both sides means both compute the same contentSha256, which
    // is what the generated site checks before it builds.
    expect(hashSiteContent(exampleSnapshot)).toBe(publishedHashes["site-content.example.json"]);
    expect(hashSiteContent(minimalSnapshot)).toBe(publishedHashes["site-content.minimal.json"]);
  });

  it("sort object keys and preserve array order", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("anti-fabrication rules agree on both sides", () => {
  it("share the same rule ids", () => {
    expect(publishedRules.rules.map((rule) => rule.id).sort()).toEqual([...CLAIM_RULE_IDS].sort());
  });

  it("flag the same text with the same rule", () => {
    // The patterns live in two codebases; this proves they still behave alike.
    const samples: { text: string; rule: string }[] = [
      { text: "Serviço a partir de valores acessíveis.", rule: "preco" },
      { text: "Somos bem avaliados pelos clientes.", rule: "avaliacao" },
      { text: "Empresa premiada na região.", rule: "premio" },
      { text: "Garantimos o resultado do reparo.", rule: "garantia" },
      { text: "O melhor serviço da cidade.", rule: "superlativo" },
      { text: "Atuamos desde 1998 no bairro.", rule: "experiencia" },
    ];

    for (const sample of samples) {
      const here = findClaimRisks([{ field: "amostra", value: sample.text }]).map((risk) => risk.rule);
      const there = publishedRules.rules
        .filter((rule) => new RegExp(rule.pattern).test(normalize(sample.text)))
        .map((rule) => rule.id);

      expect(here, `regra local para "${sample.text}"`).toContain(sample.rule);
      expect(there, `regra publicada para "${sample.text}"`).toContain(sample.rule);
    }
  });
});

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

describe("a brief exported by the NOX OS is accepted by the site-kit", () => {
  it("produces a valid snapshot from a brief plus the linked lead", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business,
      privacy,
    });

    expect(validateContent(snapshot), explain()).toBe(true);
  });

  it("produces a valid snapshot from a brief with no lead attached", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business: null,
      privacy,
    });

    expect(validateContent(snapshot), explain()).toBe(true);
    expect((snapshot.contact as Record<string, unknown>).phone).toBeNull();
    expect((snapshot.seo as Record<string, unknown>).localBusinessType).toBeNull();
  });

  it("carries the confirmed lead data across without inventing anything", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business,
      privacy,
    });

    const contact = snapshot.contact as Record<string, { value: unknown } | null>;
    expect(contact.phone?.value).toBe("+5511900000000");
    expect(contact.coordinates?.value).toEqual({ latitude: -23.5505, longitude: -46.6333 });
    // A phone is not a WhatsApp confirmation.
    expect(contact.whatsapp).toBeNull();
  });

  it("drops social links that are not https or not a recognised network", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business: {
        ...business,
        socialLinks: [
          "http://instagram.com/inseguro",
          "https://site-qualquer.test/perfil",
          "https://facebook.com/exemplo-demonstracao",
        ],
      },
      privacy,
    });

    const links = (snapshot.contact as { socialLinks: { value: { platform: string } }[] }).socialLinks;
    expect(links).toHaveLength(1);
    expect(links[0]?.value.platform).toBe("FACEBOOK");
    expect(validateContent(snapshot), explain()).toBe(true);
  });

  it("omits a service page when the brief only knows the service name", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business,
      privacy,
    });

    // The Phase 1 brief stores a name and nothing else, which cannot describe a
    // page without inventing the copy.
    expect(snapshot.services).toEqual([]);
    expect(validateContent(snapshot), explain()).toBe(true);
  });

  it("emits a service page once the operator supplies the copy", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: brief(),
      siteUrl: "https://exemplo-demonstracao.test",
      business,
      privacy,
      serviceDetails: {
        "Reparos hidráulicos": {
          slug: "reparos-hidraulicos",
          summary: "Conserto de vazamentos, torneiras e registros em pontos internos.",
          body: ["Avaliamos o ponto afetado e executamos o reparo na mesma visita quando há peça."],
          featured: true,
        },
      },
    });

    const services = snapshot.services as { slug: string; featured: boolean }[];
    expect(services).toHaveLength(1);
    expect(services[0]?.slug).toBe("reparos-hidraulicos");
    expect(validateContent(snapshot), explain()).toBe(true);
  });

  it("refuses to truncate a text that does not fit the site contract", () => {
    const long = "a".repeat(700);
    expect(() =>
      buildSiteContentSnapshot({
        brief: brief({ positioning: fact(long) }),
        siteUrl: "https://exemplo-demonstracao.test",
        business,
        privacy,
      }),
    ).toThrow(SiteExportError);
  });

  it("rejects a brief that states something the record cannot back up", () => {
    expect(() => brief({ positioning: fact("O melhor serviço da cidade, premiado desde 1998.") })).toThrow();
  });
});
