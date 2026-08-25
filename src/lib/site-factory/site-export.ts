import { createHash } from "node:crypto";

import {
  briefPublicContact,
  isSiteBriefV2,
  type BriefPublicContact,
  type SiteBrief,
} from "./brief-schema";

/**
 * Projects an approved brief onto the publishable snapshot the generated site
 * consumes (`@nox/site-kit` content contract, schemaVersion 1).
 *
 * The NOX OS never imports the site-kit package — the two must be able to ship
 * independently — so the shape is reproduced here and pinned by a contract test
 * that validates this output against the versioned JSON Schema and the negative
 * fixtures the kit exports.
 *
 * Two rules are structural rather than reviewed:
 *
 * 1. **This function never sees the lead record.** A `Business` row is a source
 *    of candidates for a person to confirm, not a source of published facts.
 *    There is no parameter through which a raw phone, address or social link
 *    could arrive, so none can reach a public page.
 * 2. **Nothing is truncated in silence.** A text that does not fit the contract
 *    raises, so an operator shortens it instead of the exporter deciding what
 *    to cut.
 */

export const SITE_CONTENT_SCHEMA_VERSION = 1 as const;

type FactSource = "LEAD" | "OPERADOR" | "CLIENTE" | "IMPORTACAO";

type Fact<T> = { value: T; source: FactSource; confirmedAt: string };

export type SiteExportInput = {
  brief: SiteBrief;
  siteUrl: string;
  /** Meta description. Falls back to the positioning when it fits in 180. */
  seoDescription?: string | null;
  /**
   * Confirmed public data. Defaults to what the brief carries; a caller may
   * pass a narrower set, never a wider one — anything here must already have
   * been confirmed field by field.
   */
  publicContact?: BriefPublicContact;
  privacy: {
    controllerName: string;
    contactEmail?: string | null;
    updatedAt: string;
    sections: { heading: string; body: string[] }[];
  };
};

export class SiteExportError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "SiteExportError";
    this.field = field;
  }
}

function limit(field: string, value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new SiteExportError(
      field,
      `"${field}" tem ${trimmed.length} caracteres e o contrato do site aceita ${max}. Encurte o texto no briefing.`,
    );
  }
  return trimmed;
}

/**
 * Copies a confirmed fact across, keeping its own source and its own moment of
 * confirmation. Reusing another field's confirmation would claim someone
 * checked this value when nobody did.
 */
function carry<T>(fact: Fact<T>): Fact<T> {
  return { value: fact.value, source: fact.source, confirmedAt: fact.confirmedAt };
}

function carryText(field: string, fact: Fact<string>, max: number): Fact<string> {
  return { value: limit(field, fact.value, max), source: fact.source, confirmedAt: fact.confirmedAt };
}

export function buildSiteContentSnapshot(input: SiteExportInput): Record<string, unknown> {
  const { brief } = input;
  const contact = input.publicContact ?? briefPublicContact(brief);

  const seoDescription = limit(
    "seo.description",
    input.seoDescription?.trim() || brief.positioning.value,
    180,
  );

  const services = isSiteBriefV2(brief)
    ? brief.services.map((service) => ({
        slug: service.id,
        name: carryText(`services[${service.id}].name`, service.name, 120),
        summary: carryText(`services[${service.id}].summary`, service.summary, 320),
        body: service.body.map((paragraph, index) =>
          carryText(`services[${service.id}].body[${index}]`, paragraph, 1500),
        ),
        image: null,
        featured: service.featured,
        relatedSlugs: service.relatedIds,
      }))
    : // A v1 brief names services without describing them. Publishing a page
      // from a name alone would mean inventing the copy, so none is emitted.
      [];

  const socialLinks = contact.socialLinks.map((link) => carry(link));

  // Only channels that were actually confirmed get a button.
  const callsToAction: Record<string, unknown>[] = [];
  if (contact.whatsapp) {
    callsToAction.push({
      label: "Falar no WhatsApp",
      kind: "WHATSAPP",
      target: null,
      location: "hero",
      primary: true,
    });
  }
  if (contact.phone) {
    callsToAction.push({
      label: "Ligar",
      kind: "TELEFONE",
      target: null,
      location: "hero",
      primary: !contact.whatsapp,
    });
  }
  if (services.length > 0) {
    callsToAction.push({
      label: "Ver serviços",
      kind: "INTERNO",
      target: "/servicos",
      location: "hero",
      primary: false,
    });
  }

  return {
    schemaVersion: SITE_CONTENT_SCHEMA_VERSION,
    business: {
      name: carryText("business.name", brief.businessName, 120),
      legalName: null,
      description: carryText("business.description", brief.positioning, 600),
      sector: carryText("business.sector", brief.sector, 120),
      logo: null,
    },
    contact: {
      phone: contact.phone ? carry(contact.phone) : null,
      whatsapp: contact.whatsapp ? carry(contact.whatsapp) : null,
      email: contact.email ? carry(contact.email) : null,
      address: contact.address ? carry(contact.address) : null,
      coordinates: contact.coordinates ? carry(contact.coordinates) : null,
      openingHours: contact.openingHours ? carry(contact.openingHours) : null,
      socialLinks,
    },
    about: {
      // The heading is a label we choose, not a claim about the client, so it
      // carries the objective's confirmation rather than inventing one.
      heading: {
        value: "Sobre",
        source: brief.objective.source,
        confirmedAt: brief.objective.confirmedAt,
      },
      body: [
        carryText("about.body[0]", brief.objective, 1500),
        carryText("about.body[1]", brief.audience, 1500),
      ],
    },
    services,
    gallery: [],
    callsToAction,
    branding: {
      primaryColor: "#1d4ed8",
      accentColor: "#0f766e",
      surfaceColor: "#ffffff",
      textColor: "#111827",
      fontFamily: "sans",
      radius: "md",
    },
    seo: {
      siteUrl: input.siteUrl,
      defaultTitle: limit("seo.defaultTitle", brief.businessName.value, 70),
      titleTemplate: null,
      description: seoDescription,
      ogImage: null,
      // Structured data about a physical business needs an address to stand on.
      localBusinessType: contact.address ? "LocalBusiness" : null,
      locale: "pt_BR",
    },
    analytics: { provider: "none", measurementId: null, consentMode: "required" },
    privacy: {
      controllerName: limit("privacy.controllerName", input.privacy.controllerName, 180),
      contactEmail: input.privacy.contactEmail?.trim() || null,
      updatedAt: input.privacy.updatedAt,
      sections: input.privacy.sections,
    },
  };
}

// ---------------------------------------------------------------------------
// Manifesto
// ---------------------------------------------------------------------------

export type SiteManifestInput = {
  projectRef: string;
  briefVersion: number;
  factsHash: string;
  content: unknown;
  /**
   * The immutable template commit this site was generated from. It is an input
   * because only the generator knows it: deducing it inside the generated
   * repository is self-referential and always lands one commit behind, since
   * the commit that contains a manifest cannot be the commit it names.
   */
  templateCommit: string;
  templateRepository: string;
  siteKit: { version: string; sha256: string };
  generatedAt: string;
};

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function buildSiteManifest(input: SiteManifestInput): Record<string, unknown> {
  if (!COMMIT_PATTERN.test(input.templateCommit)) {
    throw new SiteExportError(
      "template.commitSha",
      "Informe o commit completo do template, com 40 caracteres hexadecimais.",
    );
  }
  if (!SHA256_PATTERN.test(input.factsHash)) {
    throw new SiteExportError("factsHash", "factsHash precisa ser um SHA-256 em minúsculas.");
  }
  if (!SHA256_PATTERN.test(input.siteKit.sha256)) {
    throw new SiteExportError("siteKit.sha256", "siteKit.sha256 precisa ser um SHA-256 em minúsculas.");
  }

  const contentSha256 = hashSiteContent(input.content);

  // The two fingerprints answer different questions; equal values almost always
  // mean one was copied into the other by mistake.
  if (contentSha256 === input.factsHash) {
    throw new SiteExportError(
      "contentSha256",
      "factsHash identifica o briefing e contentSha256 identifica o snapshot. Iguais, um foi copiado no lugar do outro.",
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    projectRef: input.projectRef,
    briefVersion: input.briefVersion,
    factsHash: input.factsHash,
    contentSha256,
    template: { repository: input.templateRepository, commitSha: input.templateCommit },
    siteKit: { version: input.siteKit.version, sha256: input.siteKit.sha256 },
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Canonical JSON with sorted keys — the same rule the site-kit applies, so both
 * sides compute the same `contentSha256` for the same snapshot.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== "object") return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function hashSiteContent(content: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(content)).digest("hex");
}
