import { createHash } from "node:crypto";

import type { SiteBrief } from "./brief-schema";

/**
 * Projects an approved brief onto the publishable snapshot the generated site
 * consumes (`@nox/site-kit` content contract, schemaVersion 1).
 *
 * The NOX OS never imports the site-kit package — the two must be able to ship
 * independently — so the shape is reproduced here and pinned by a contract test
 * that validates this output against the versioned JSON Schema exported by the
 * kit. If the two ever drift, that test fails rather than a client's site.
 *
 * Nothing is invented and nothing is silently truncated: a field that does not
 * fit the contract raises, so an operator shortens the text instead of the
 * exporter deciding what to cut.
 */

export const SITE_CONTENT_SCHEMA_VERSION = 1 as const;

type FactSource = "LEAD" | "OPERADOR" | "CLIENTE" | "IMPORTACAO";

type Fact<T> = { value: T; source: FactSource; confirmedAt: string };

export type SiteExportBusiness = {
  name: string;
  category: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phoneE164: string | null;
  socialLinks: string[];
  latitude: number | null;
  longitude: number | null;
};

/**
 * Per-service copy the brief cannot express yet. The Phase 1 brief stores only
 * a service name, which is not enough to publish a service page without
 * inventing the rest — so a page is generated only where this detail exists.
 */
export type SiteExportServiceDetail = {
  slug: string;
  summary: string;
  body: string[];
  featured?: boolean;
  relatedSlugs?: string[];
};

export type SiteExportInput = {
  brief: SiteBrief;
  siteUrl: string;
  /** Meta description. Falls back to the positioning when it fits in 180. */
  seoDescription?: string | null;
  business?: SiteExportBusiness | null;
  serviceDetails?: Record<string, SiteExportServiceDetail>;
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

function fact<T>(value: T, source: FactSource, confirmedAt: string): Fact<T> {
  return { value, source, confirmedAt };
}

const SOCIAL_HOSTS: { pattern: RegExp; platform: string }[] = [
  { pattern: /(^|\.)instagram\.com$/, platform: "INSTAGRAM" },
  { pattern: /(^|\.)facebook\.com$/, platform: "FACEBOOK" },
  { pattern: /(^|\.)linkedin\.com$/, platform: "LINKEDIN" },
  { pattern: /(^|\.)youtube\.com$/, platform: "YOUTUBE" },
  { pattern: /(^|\.)tiktok\.com$/, platform: "TIKTOK" },
  { pattern: /(^|\.)(x|twitter)\.com$/, platform: "X" },
];

/** Only https links on a recognised network survive; anything else is dropped. */
function toSocialLinks(urls: string[], confirmedAt: string) {
  const links: Fact<{ platform: string; url: string; label: null }>[] = [];

  for (const raw of urls.slice(0, 12)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const match = SOCIAL_HOSTS.find((candidate) => candidate.pattern.test(host));
    if (!match) continue;

    links.push(fact({ platform: match.platform, url: url.toString(), label: null }, "LEAD", confirmedAt));
  }

  return links;
}

export function buildSiteContentSnapshot(input: SiteExportInput): Record<string, unknown> {
  const { brief, business } = input;
  const confirmedAt = brief.businessName.confirmedAt;

  const description = limit("business.description", brief.positioning.value, 600);
  const seoDescription = limit(
    "seo.description",
    input.seoDescription?.trim() || brief.positioning.value,
    180,
  );

  const services = brief.services
    .map((service) => {
      const detail = input.serviceDetails?.[service.value];
      // No detail means no service page: the brief alone cannot describe one
      // without inventing a summary and a body.
      if (!detail) return null;
      return {
        slug: detail.slug,
        name: fact(limit("services[].name", service.value, 120), service.source, service.confirmedAt),
        summary: fact(limit("services[].summary", detail.summary, 320), "OPERADOR", confirmedAt),
        body: detail.body.map((paragraph, index) =>
          fact(limit(`services[].body[${index}]`, paragraph, 1500), "OPERADOR", confirmedAt),
        ),
        image: null,
        featured: detail.featured ?? false,
        relatedSlugs: detail.relatedSlugs ?? [],
      };
    })
    .filter((service): service is NonNullable<typeof service> => service !== null);

  const address =
    business?.address && business.city && business.state
      ? fact(
          {
            street: limit("contact.address.street", business.address, 180),
            number: null,
            complement: null,
            neighborhood: business.neighborhood?.trim() || null,
            city: business.city,
            state: business.state,
            postalCode: business.postalCode?.trim() || null,
            country: "Brasil",
          },
          "LEAD",
          confirmedAt,
        )
      : null;

  const coordinates =
    business && business.latitude !== null && business.longitude !== null
      ? fact({ latitude: business.latitude, longitude: business.longitude }, "LEAD", confirmedAt)
      : null;

  return {
    schemaVersion: SITE_CONTENT_SCHEMA_VERSION,
    business: {
      name: fact(
        limit("business.name", business?.name ?? brief.businessName.value, 120),
        brief.businessName.source,
        confirmedAt,
      ),
      legalName: null,
      description: fact(description, brief.positioning.source, brief.positioning.confirmedAt),
      sector: fact(limit("business.sector", brief.sector.value, 120), brief.sector.source, brief.sector.confirmedAt),
      logo: null,
    },
    contact: {
      phone: business?.phoneE164
        ? fact(business.phoneE164, "LEAD", confirmedAt)
        : null,
      // WhatsApp is a separate confirmation: having a phone does not mean the
      // business answers on WhatsApp.
      whatsapp: null,
      email: null,
      address,
      coordinates,
      openingHours: null,
      socialLinks: business ? toSocialLinks(business.socialLinks, confirmedAt) : [],
    },
    about: {
      heading: fact("Sobre", "OPERADOR", confirmedAt),
      body: [
        fact(limit("about.body[0]", brief.objective.value, 1500), brief.objective.source, brief.objective.confirmedAt),
        fact(limit("about.body[1]", brief.audience.value, 1500), brief.audience.source, brief.audience.confirmedAt),
      ],
    },
    services,
    gallery: [],
    callsToAction: business?.phoneE164
      ? [{ label: "Ligar", kind: "TELEFONE", target: null, location: "hero", primary: true }]
      : [],
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
      defaultTitle: limit("seo.defaultTitle", business?.name ?? brief.businessName.value, 70),
      titleTemplate: null,
      description: seoDescription,
      ogImage: null,
      // A LocalBusiness node needs a confirmed address; without one the site
      // simply does not emit it.
      localBusinessType: address ? "LocalBusiness" : null,
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
