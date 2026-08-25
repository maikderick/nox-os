import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { CLAIM_RULE_IDS, findClaimRisks } from "@/lib/content-integrity";
import {
  briefCapabilities,
  siteBriefSchema,
  type SiteBrief,
  type SiteBriefV2,
} from "@/lib/site-factory/brief-schema";
import {
  buildSiteContentSnapshot,
  buildSiteManifest,
  canonicalJsonStringify,
  hashSiteContent,
  SiteExportError,
} from "@/lib/site-factory/site-export";
import { validateSnapshotInvariants } from "@/lib/site-factory/snapshot-contract";

/**
 * Contract test between two independent parsers.
 *
 * The NOX OS does not import `@nox/site-kit` — the server and the generated
 * sites have to ship on their own schedules. What keeps them honest is the
 * versioned copy of the kit's artifacts in `contracts/site-kit/`:
 *
 * - the JSON Schema, for everything a schema can express;
 * - the negative fixtures, one per cross-field invariant, for everything it
 *   cannot. A snapshot this server approves has to be refused in every one of
 *   those cases, which is what forces the invariants to be implemented rather
 *   than assumed.
 *
 * Refresh with `npm run export:artifacts` in the nox-site-kit repository.
 */

const contractsDir = resolve(process.cwd(), "contracts/site-kit");

function readArtifact<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(contractsDir, name), "utf8")) as T;
}

const contentSchema = readArtifact<Record<string, unknown>>("site-content.schema.json");
const manifestSchema = readArtifact<Record<string, unknown>>("site-manifest.schema.json");
const exampleSnapshot = readArtifact<Record<string, unknown>>("site-content.example.json");
const minimalSnapshot = readArtifact<Record<string, unknown>>("site-content.minimal.json");
const publishedHashes = readArtifact<Record<string, string>>("hashes.json");
const publishedRules = readArtifact<{
  schemaVersion: number;
  rules: { id: string; label: string; pattern: string }[];
}>("fabrication-rules.json");
const invariants = readArtifact<{
  schemaVersion: number;
  cases: { id: string; description: string; expectedPath: string; fixture: string }[];
}>("invariants.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateAgainstSchema = ajv.compile(contentSchema);
const validateManifestAgainstSchema = ajv.compile(manifestSchema);

/** The complete gate: everything a schema expresses, plus everything it cannot. */
function validateSnapshot(content: unknown): string[] {
  const problems: string[] = [];
  if (!validateAgainstSchema(content)) {
    for (const error of validateAgainstSchema.errors ?? []) {
      problems.push(`${error.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(raiz)"} ${error.message}`);
    }
  }
  for (const issue of validateSnapshotInvariants(content)) {
    problems.push(`${issue.path} ${issue.message}`);
  }
  return problems;
}

const CONFIRMED_AT = "2026-08-25T12:00:00.000-03:00";
const LATER = "2026-08-25T15:30:00.000-03:00";

function fact(value: string, confirmedAt = CONFIRMED_AT) {
  return { value, source: "OPERADOR" as const, confirmedAt };
}

const NARRATIVE = {
  businessName: fact("Oficina Demonstração NOX"),
  sector: fact("Manutenção residencial"),
  city: fact("São Paulo"),
  objective: fact("Apresentar os serviços de manutenção residencial e receber contatos."),
  audience: fact("Moradores e pequenos comércios da região central."),
  positioning: fact(
    "Serviços de manutenção residencial planejados e executados por equipe própria, com atendimento agendado.",
  ),
  differentiators: [fact("Atendimento agendado")],
  desiredSections: ["inicio", "sobre", "servicos", "contato"],
  visualDirection: fact("Visual limpo, com foco em leitura e contraste alto."),
  notes: null,
};

function briefV1(overrides: Record<string, unknown> = {}): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 1,
    ...NARRATIVE,
    services: [fact("Reparos hidráulicos"), fact("Instalações elétricas")],
    ...overrides,
  });
}

function briefV2(overrides: Record<string, unknown> = {}): SiteBriefV2 {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    ...NARRATIVE,
    services: [
      {
        id: "reparos-hidraulicos",
        name: fact("Reparos hidráulicos"),
        summary: fact("Conserto de vazamentos, torneiras e registros em pontos internos."),
        body: [fact("Avaliamos o ponto afetado e executamos o reparo na mesma visita quando há peça.")],
        featured: true,
        relatedIds: [],
      },
    ],
    publicContact: {},
    ...overrides,
  }) as SiteBriefV2;
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

const SITE_URL = "https://exemplo-demonstracao.test";

// ---------------------------------------------------------------------------

describe("the artifacts published by the site-kit", () => {
  it("target the schema version this server exports", () => {
    expect(publishedRules.schemaVersion).toBe(1);
    expect(invariants.schemaVersion).toBe(1);
    expect(exampleSnapshot.schemaVersion).toBe(1);
  });

  it("accept their own example and minimal fixtures", () => {
    expect(validateSnapshot(exampleSnapshot)).toEqual([]);
    expect(validateSnapshot(minimalSnapshot)).toEqual([]);
  });

  it("canonicalise exactly the way this server does", () => {
    expect(hashSiteContent(exampleSnapshot)).toBe(publishedHashes["site-content.example.json"]);
    expect(hashSiteContent(minimalSnapshot)).toBe(publishedHashes["site-content.minimal.json"]);
  });

  it("sort object keys and preserve array order", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("every invariant the JSON Schema cannot express", () => {
  it("publishes a fixture for each case", () => {
    const files = readdirSync(resolve(contractsDir, "invalid"));
    expect(files).toHaveLength(invariants.cases.length);
    expect(invariants.cases.length).toBeGreaterThanOrEqual(16);
  });

  for (const testCase of invariants.cases) {
    it(`refuses ${testCase.id}: ${testCase.description}`, () => {
      const fixture = readArtifact<Record<string, unknown>>(testCase.fixture);
      const problems = validateSnapshot(fixture);

      expect(problems, `${testCase.id} deveria ser recusado`).not.toEqual([]);
      expect(
        problems.some((problem) => problem.startsWith(testCase.expectedPath)),
        `${testCase.id} falhou, mas em: ${problems.join(" | ")}`,
      ).toBe(true);
    });
  }

  it("would pass the schema alone for the cross-field cases, which is why the invariants exist", () => {
    // If the schema caught these, the invariants module would be dead code and
    // this test would stop meaning anything.
    const crossField = ["slug-duplicado", "cta-whatsapp-sem-canal", "local-business-sem-endereco"];
    for (const id of crossField) {
      const testCase = invariants.cases.find((candidate) => candidate.id === id);
      expect(testCase, id).toBeDefined();
      const fixture = readArtifact<Record<string, unknown>>(testCase!.fixture);
      expect(validateAgainstSchema(fixture), `${id} deveria passar só pelo schema`).toBe(true);
      expect(validateSnapshotInvariants(fixture).length, id).toBeGreaterThan(0);
    }
  });
});

describe("anti-fabrication rules agree on both sides", () => {
  it("share the same rule ids", () => {
    expect(publishedRules.rules.map((rule) => rule.id).sort()).toEqual([...CLAIM_RULE_IDS].sort());
  });

  it("flag the same text with the same rule", () => {
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

      expect(here, sample.text).toContain(sample.rule);
      expect(there, sample.text).toContain(sample.rule);
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

// ---------------------------------------------------------------------------

describe("a brief exported by the NOX OS is accepted by the site-kit", () => {
  it("produces a valid snapshot from a v1 brief", () => {
    expect(validateSnapshot(buildSiteContentSnapshot({ brief: briefV1(), siteUrl: SITE_URL, privacy }))).toEqual([]);
  });

  it("produces a valid snapshot from a v2 brief with confirmed services and contact", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: briefV2({
        publicContact: {
          phone: { value: "+5511900000000", source: "CLIENTE", confirmedAt: LATER },
          address: {
            value: { street: "Rua da Demonstração", city: "São Paulo", state: "SP" },
            source: "CLIENTE",
            confirmedAt: LATER,
          },
        },
      }),
      siteUrl: SITE_URL,
      privacy,
    });

    expect(validateSnapshot(snapshot)).toEqual([]);
    expect((snapshot.services as unknown[]).length).toBe(1);
  });

  it("omits a service page when the brief only knows the service name", () => {
    const snapshot = buildSiteContentSnapshot({ brief: briefV1(), siteUrl: SITE_URL, privacy });
    expect(snapshot.services).toEqual([]);
  });

  it("refuses to truncate a text that does not fit the site contract", () => {
    expect(() =>
      buildSiteContentSnapshot({
        brief: briefV1({ positioning: fact("a".repeat(700)) }),
        siteUrl: SITE_URL,
        privacy,
      }),
    ).toThrow(SiteExportError);
  });
});

// ---------------------------------------------------------------------------

describe("no public field borrows another field's confirmation", () => {
  it("omits every contact channel the brief did not confirm", () => {
    const snapshot = buildSiteContentSnapshot({ brief: briefV2(), siteUrl: SITE_URL, privacy });
    const contact = snapshot.contact as Record<string, unknown>;

    expect(contact.phone).toBeNull();
    expect(contact.whatsapp).toBeNull();
    expect(contact.email).toBeNull();
    expect(contact.address).toBeNull();
    expect(contact.coordinates).toBeNull();
    expect(contact.openingHours).toBeNull();
    expect(contact.socialLinks).toEqual([]);
    expect((snapshot.seo as Record<string, unknown>).localBusinessType).toBeNull();

    // Internal navigation is a decision we make, not a claim about the client;
    // what must be absent is every button that would need a confirmed channel.
    const kinds = (snapshot.callsToAction as { kind: string }[]).map((cta) => cta.kind);
    expect(kinds).not.toContain("WHATSAPP");
    expect(kinds).not.toContain("TELEFONE");
    expect(kinds).not.toContain("EMAIL");
  });

  it("keeps each field's own source and moment of confirmation", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: briefV2({
        publicContact: {
          phone: { value: "+5511900000000", source: "CLIENTE", confirmedAt: LATER },
        },
      }),
      siteUrl: SITE_URL,
      privacy,
    });

    const contact = snapshot.contact as Record<string, { source: string; confirmedAt: string }>;
    const business = snapshot.business as Record<string, { source: string; confirmedAt: string }>;

    // Confirming a business name says nothing about whether the phone was
    // checked, so the two must not share a timestamp by construction.
    expect(contact.phone!.source).toBe("CLIENTE");
    expect(contact.phone!.confirmedAt).toBe(LATER);
    expect(business.name!.confirmedAt).toBe(CONFIRMED_AT);
    expect(contact.phone!.confirmedAt).not.toBe(business.name!.confirmedAt);
  });

  it("confirming a phone does not confirm a WhatsApp on the same number", () => {
    const snapshot = buildSiteContentSnapshot({
      brief: briefV2({
        publicContact: {
          phone: { value: "+5511900000000", source: "CLIENTE", confirmedAt: LATER },
        },
      }),
      siteUrl: SITE_URL,
      privacy,
    });

    expect((snapshot.contact as Record<string, unknown>).whatsapp).toBeNull();
    const ctas = snapshot.callsToAction as { kind: string }[];
    expect(ctas.map((cta) => cta.kind)).not.toContain("WHATSAPP");
  });

  /**
   * The strongest guarantee is structural: `buildSiteContentSnapshot` has no
   * parameter through which a lead record could arrive. This proves it by
   * running an export while a lead full of distinctive raw values exists, and
   * searching the serialised snapshot for any of them.
   */
  it("never leaks raw lead data into the public snapshot", () => {
    const rawLead = {
      name: "Oficina Demonstração NOX",
      phoneRaw: "(11) 98888-7777",
      phoneE164: "+5511988887777",
      address: "Rua Que Nao Foi Confirmada, 999",
      neighborhood: "Bairro Nao Confirmado",
      postalCode: "09999-999",
      website: "https://site-nao-confirmado.test",
      socialLinks: ["https://instagram.com/perfil-nao-confirmado"],
      latitude: -19.912998,
      longitude: -43.940933,
      notesText: "anotação interna do operador",
      opportunityScore: 87,
    };

    const snapshot = buildSiteContentSnapshot({ brief: briefV2(), siteUrl: SITE_URL, privacy });
    const serialised = canonicalJsonStringify(snapshot);

    const leaked = Object.entries(rawLead)
      .filter(([key]) => key !== "name")
      .flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value])
          .map(String)
          .filter((candidate) => serialised.includes(candidate))
          .map((candidate) => `${key}=${candidate}`),
      );

    expect(leaked, `dados brutos no snapshot: ${leaked.join(", ")}`).toEqual([]);
  });

  it("refuses a public value that was never confirmed, even when the lead has one", () => {
    // There is no parameter for it: the only way in is a confirmed fact.
    const snapshot = buildSiteContentSnapshot({ brief: briefV2(), siteUrl: SITE_URL, privacy });
    expect(canonicalJsonStringify(snapshot)).not.toContain("+5511988887777");
  });
});

// ---------------------------------------------------------------------------

describe("brief versions", () => {
  it("reads a v1 brief that predates the version field", () => {
    const legacy = { ...NARRATIVE, services: [fact("Reparos hidráulicos")] };
    const parsed = siteBriefSchema.parse(legacy);
    expect(parsed.schemaVersion).toBe(1);
  });

  it("keeps v1 briefs readable without rewriting them", () => {
    const brief = briefV1();
    expect(brief.schemaVersion).toBe(1);
    expect(briefCapabilities(brief).canGenerateServicePages).toBe(false);
  });

  it("reports a v1 brief as insufficient for full service pages", () => {
    const capabilities = briefCapabilities(briefV1());
    expect(capabilities.schemaVersion).toBe(1);
    expect(capabilities.hasConfirmedPublicContact).toBe(false);
    expect(capabilities.gaps.join(" ")).toMatch(/v1 guarda apenas o nome/);
  });

  it("reports a v2 brief with confirmed services as sufficient", () => {
    const capabilities = briefCapabilities(
      briefV2({
        publicContact: { phone: { value: "+5511900000000", source: "CLIENTE", confirmedAt: LATER } },
      }),
    );
    expect(capabilities.schemaVersion).toBe(2);
    expect(capabilities.canGenerateServicePages).toBe(true);
    expect(capabilities.hasConfirmedPublicContact).toBe(true);
    expect(capabilities.gaps).toEqual([]);
  });

  it("requires a stable id, a confirmed summary and confirmed body on a v2 service", () => {
    for (const broken of [
      { id: undefined },
      { summary: undefined },
      { body: [] },
      { id: "Nao Eh Slug" },
    ]) {
      expect(() =>
        briefV2({
          services: [
            {
              id: "reparos-hidraulicos",
              name: fact("Reparos hidráulicos"),
              summary: fact("Conserto de vazamentos."),
              body: [fact("Avaliamos o ponto afetado.")],
              ...broken,
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("refuses a repeated service id and a relation that does not resolve", () => {
    const service = {
      id: "reparos-hidraulicos",
      name: fact("Reparos hidráulicos"),
      summary: fact("Conserto de vazamentos."),
      body: [fact("Avaliamos o ponto afetado.")],
    };
    expect(() => briefV2({ services: [service, { ...service }] })).toThrow();
    expect(() => briefV2({ services: [{ ...service, relatedIds: ["nao-existe"] }] })).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("provenance", () => {
  const base = {
    projectRef: "demo-oficina-nox",
    briefVersion: 3,
    factsHash: "a".repeat(64),
    templateRepository: "https://github.com/nox-os/nox-site-template",
    siteKit: { version: "0.2.0", sha256: "d".repeat(64) },
    generatedAt: CONFIRMED_AT,
  };

  const content = buildSiteContentSnapshot({ brief: briefV2(), siteUrl: SITE_URL, privacy });

  it("declares exactly the template commit it was given", () => {
    const templateCommit = "c".repeat(40);
    const manifest = buildSiteManifest({ ...base, content, templateCommit });

    expect((manifest.template as Record<string, string>).commitSha).toBe(templateCommit);
    expect(validateManifestAgainstSchema(manifest), JSON.stringify(validateManifestAgainstSchema.errors)).toBe(true);
  });

  it("records the fingerprint of the snapshot it actually received", () => {
    const manifest = buildSiteManifest({ ...base, content, templateCommit: "c".repeat(40) });
    expect(manifest.contentSha256).toBe(hashSiteContent(content));
  });

  it("refuses a commit that is not a full 40-character sha", () => {
    for (const bad of ["", "c1c2c3", "C".repeat(40), "z".repeat(40), "HEAD"]) {
      expect(() => buildSiteManifest({ ...base, content, templateCommit: bad })).toThrow(SiteExportError);
    }
  });

  it("refuses a manifest whose factsHash was copied into contentSha256", () => {
    expect(() =>
      buildSiteManifest({
        ...base,
        content,
        templateCommit: "c".repeat(40),
        factsHash: hashSiteContent(content),
      }),
    ).toThrow(SiteExportError);
  });
});
