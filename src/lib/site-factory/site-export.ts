import { createHash } from "node:crypto";

import { resolveArtDirection, type FontToken } from "@/lib/design/art-direction";

import {
  briefPublicContact,
  isSiteBriefV2,
  type BriefPublicContact,
  type SiteBrief,
} from "./brief-schema";
import { publicBusinessName } from "./display-name";

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
 *    could arrive, so none can reach a public page. `branding` is resolved by
 *    `resolveArtDirection`, a pure function of the confirmed `sector` and the
 *    project id — a static table lookup, not a new path for a lead or an
 *    external value to reach the snapshot, so this rule still holds.
 * 2. **Nothing is truncated in silence.** A text that does not fit the contract
 *    raises, so an operator shortens it instead of the exporter deciding what
 *    to cut.
 */

/**
 * Fonts whose family the generated site's contract must render as "serif".
 * Every other `FontToken` in the closed roster maps to "sans".
 */
const SERIF_FONTS = new Set<FontToken>(["fraunces", "source-serif", "instrument-serif"]);

export const SITE_CONTENT_SCHEMA_VERSION = 2 as const;

type FactSource = "LEAD" | "OPERADOR" | "CLIENTE" | "IMPORTACAO";

type Fact<T> = { value: T; source: FactSource; confirmedAt: string };

export const PUBLIC_CONTACT_FIELDS = [
  "phone",
  "whatsapp",
  "email",
  "address",
  "coordinates",
  "openingHours",
  "socialLinks",
] as const;

export type PublicContactField = (typeof PUBLIC_CONTACT_FIELDS)[number];

export type SiteExportInput = {
  brief: SiteBrief;
  siteUrl: string;
  /**
   * `SiteProject.id`. Fixes the art direction so the snapshot is reproducible
   * and matches what the preview and the generation prompt already show —
   * both resolve the same direction from this same id.
   */
  seed: string;
  /**
   * Which confirmed channels to publish. **Names only, never values.**
   *
   * A caller sometimes needs to publish less than the brief confirmed — a
   * client who confirmed a phone but does not want it on the site. Expressing
   * that as a list of field names means the only thing a caller can do is
   * narrow: there is no shape here that could carry a phone number, so no
   * caller can introduce one. Omitting it publishes everything the brief
   * confirmed.
   */
  publishContactFields?: readonly PublicContactField[];
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

/**
 * Narrows the brief's confirmed contact to the requested fields.
 *
 * Only removal is possible: a field name that the brief did not confirm still
 * resolves to nothing, so asking for more than was confirmed publishes nothing
 * more.
 */
function selectContact(
  contact: BriefPublicContact,
  fields: readonly PublicContactField[] | undefined,
): BriefPublicContact {
  if (!fields) return contact;
  const allowed = new Set(fields);
  return {
    phone: allowed.has("phone") ? contact.phone : null,
    whatsapp: allowed.has("whatsapp") ? contact.whatsapp : null,
    email: allowed.has("email") ? contact.email : null,
    address: allowed.has("address") ? contact.address : null,
    coordinates: allowed.has("coordinates") ? contact.coordinates : null,
    openingHours: allowed.has("openingHours") ? contact.openingHours : null,
    socialLinks: allowed.has("socialLinks") ? contact.socialLinks : [],
  };
}

export function buildSiteContentSnapshot(input: SiteExportInput): Record<string, unknown> {
  const { brief } = input;
  const contact = selectContact(briefPublicContact(brief), input.publishContactFields);
  const direction = resolveArtDirection({ sector: brief.sector.value, seed: input.seed });

  /*
   * The meta description is derived from confirmed text, never typed in here.
   * A v2 brief can confirm one of its own; otherwise the positioning is used,
   * and a positioning that does not fit raises rather than being cut — deciding
   * what to drop from a confirmed sentence is the operator's call, not ours.
   */
  /*
   * The "Sobre" paragraph is the presentation text when the brief has one, and
   * the positioning otherwise.
   *
   * `objective` and `audience` used to be published here. They are the two
   * operator-facing fields in the brief — what the site is for, who it targets
   * — so the section read as an internal note to the client's own customers.
   * Neither may reach a page again, which is why neither is named below.
   */
  const aboutBody = (isSiteBriefV2(brief) ? brief.about : null) ?? brief.positioning;

  /*
   * The name as it is set, carried on the confirmed fact.
   *
   * The value is re-cased, the confirmation is not: `source` and `confirmedAt`
   * stay the ones the operator produced, because how a name is typeset says
   * nothing about who checked it. Every surface reads it through the same
   * helper — the snapshot, the page, the `<title>` and the agent's prompt —
   * so a generated site cannot end up with a different name from the preview
   * the operator approved.
   */
  const businessName = {
    ...brief.businessName,
    value: publicBusinessName(brief),
  };

  const confirmedMetaDescription = isSiteBriefV2(brief) ? brief.metaDescription : null;
  const seoDescription = limit(
    "seo.description",
    (confirmedMetaDescription ?? brief.positioning).value,
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
      name: carryText("business.name", businessName, 120),
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
      // A section label is configuration, not a claim about the client. In
      // schemaVersion 2 it is a plain string, so it no longer has to borrow
      // some other fact's source and timestamp to exist.
      heading: "Sobre",
      body: [carryText("about.body[0]", aboutBody, 1500)],
    },
    services,
    gallery: [],
    callsToAction,
    // The contract carries six fields and no more; they are the load-bearing
    // half of the direction — the rest (anchor, rhythm, motion, device, …)
    // reaches the generated site through the agent's prompt, not this snapshot.
    // `primaryColor` is the accent — the contract's primary affordance colour —
    // and `textColor` is the ink; the catalogue guarantees every accent reaches
    // 3:1 against both surfaces as a fill (it was `ink` here until the fitness
    // accent was fixed to actually clear that bar).
    branding: {
      primaryColor: direction.palette.accent,
      accentColor: direction.palette.accent,
      surfaceColor: direction.palette.surface,
      textColor: direction.palette.ink,
      fontFamily: SERIF_FONTS.has(direction.type.display) ? "serif" : "sans",
      radius: direction.radius,
    },
    seo: {
      siteUrl: input.siteUrl,
      defaultTitle: limit("seo.defaultTitle", businessName.value, 70),
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
