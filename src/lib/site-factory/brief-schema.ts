import { z } from "zod";

import { findClaimRisks } from "@/lib/content-integrity";
import { plainText } from "@/lib/zod-text";

export const BRIEF_FACT_SOURCES = ["LEAD", "OPERADOR", "CLIENTE", "IMPORTACAO"] as const;

export const confirmedFactSchema = z
  .object({
    value: plainText(2_000),
    source: z.enum(BRIEF_FACT_SOURCES),
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ConfirmedFact = z.infer<typeof confirmedFactSchema>;

const shortFactSchema = confirmedFactSchema.extend({ value: plainText(160) });
const paragraphFactSchema = confirmedFactSchema.extend({ value: plainText(1_200) });

/**
 * A fact whose value is not free text — a phone number, an address, a pair of
 * coordinates. Each carries its own source and its own moment of confirmation,
 * because confirming a business name says nothing about whether its phone was
 * checked.
 */
function typedFact<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      source: z.enum(BRIEF_FACT_SOURCES),
      confirmedAt: z.string().datetime({ offset: true }),
    })
    .strict();
}

// ---------------------------------------------------------------------------
// Dados públicos confirmados (v2)
// ---------------------------------------------------------------------------

const phoneE164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Informe o telefone no formato internacional");

const clockTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM em 24 horas");

export const BRIEF_DAYS = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

export const BRIEF_SOCIAL_PLATFORMS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "X",
] as const;

const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      if (!/^https:\/\//i.test(value)) return false;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
      } catch {
        return false;
      }
    },
    { message: "Informe um endereço https válido" },
  );

const postalAddressSchema = z
  .object({
    street: plainText(180),
    number: plainText(20).nullable().default(null),
    complement: plainText(120).nullable().default(null),
    neighborhood: plainText(120).nullable().default(null),
    city: plainText(120),
    state: plainText(64),
    postalCode: plainText(20).nullable().default(null),
    country: plainText(64).default("Brasil"),
  })
  .strict();

const coordinatesSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

const openingHoursSchema = z
  .object({
    dayOfWeek: z.enum(BRIEF_DAYS),
    opens: clockTimeSchema,
    closes: clockTimeSchema,
  })
  .strict()
  .refine((value) => value.opens < value.closes, {
    message: "O horário de abertura precisa ser anterior ao de fechamento",
  });

const socialLinkSchema = z
  .object({
    platform: z.enum(BRIEF_SOCIAL_PLATFORMS),
    url: httpsUrlSchema,
    label: plainText(60).nullable().default(null),
  })
  .strict();

/**
 * Everything the site may publish about how to reach the business.
 *
 * Each channel is confirmed on its own. A lead record is a source of
 * *candidates*; nothing here is filled from it without someone confirming that
 * exact field, which is why the export refuses to read the lead at all.
 */
export const briefPublicContactSchema = z
  .object({
    phone: typedFact(phoneE164Schema).nullable().default(null),
    whatsapp: typedFact(phoneE164Schema).nullable().default(null),
    email: typedFact(z.string().trim().max(254).email()).nullable().default(null),
    address: typedFact(postalAddressSchema).nullable().default(null),
    coordinates: typedFact(coordinatesSchema).nullable().default(null),
    openingHours: typedFact(z.array(openingHoursSchema).min(1).max(14)).nullable().default(null),
    socialLinks: z.array(typedFact(socialLinkSchema)).max(12).default([]),
  })
  .strict();

export type BriefPublicContact = z.infer<typeof briefPublicContactSchema>;

export const EMPTY_PUBLIC_CONTACT: BriefPublicContact = {
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  coordinates: null,
  openingHours: null,
  socialLinks: [],
};

// ---------------------------------------------------------------------------
// Serviços (v2)
// ---------------------------------------------------------------------------

const serviceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas minúsculas, números e hífen simples");

/**
 * A service the site can actually publish a page for.
 *
 * The v1 brief stored only a name, which cannot describe a page without someone
 * inventing the copy. Here the summary and the body are confirmed facts in their
 * own right, and the id is stable so a rename never breaks a URL or a relation.
 */
export const briefServiceSchema = z
  .object({
    id: serviceIdSchema,
    name: shortFactSchema,
    summary: confirmedFactSchema.extend({ value: plainText(320) }),
    body: z.array(confirmedFactSchema.extend({ value: plainText(1_500) })).min(1).max(12),
    /**
     * The price as the business states it ("R$ 28,00", "a partir de R$ 90",
     * "sob consulta"). A confirmed fact like any other: typed by the operator,
     * never derived. Free text because businesses price in many shapes.
     */
    price: confirmedFactSchema.extend({ value: plainText(40) }).nullable().default(null),
    relatedIds: z.array(serviceIdSchema).max(6).default([]),
    featured: z.boolean().default(false),
  })
  .strict();

export type BriefService = z.infer<typeof briefServiceSchema>;

// ---------------------------------------------------------------------------
// Campos comuns às duas versões
// ---------------------------------------------------------------------------

const commonFields = {
  businessName: shortFactSchema,
  sector: shortFactSchema,
  city: shortFactSchema.nullable().default(null),
  objective: paragraphFactSchema,
  audience: paragraphFactSchema,
  positioning: paragraphFactSchema,
  differentiators: z.array(shortFactSchema).max(8).default([]),
  desiredSections: z.array(plainText(80)).min(1).max(12),
  visualDirection: paragraphFactSchema,
  notes: paragraphFactSchema.nullable().default(null),
};

type NarrativeEntry = { field: string; value: string };

function narrativeEntries(brief: {
  objective: ConfirmedFact;
  audience: ConfirmedFact;
  positioning: ConfirmedFact;
  visualDirection: ConfirmedFact;
  notes: ConfirmedFact | null;
  differentiators: ConfirmedFact[];
  /** v2 only — a v1 brief has no presentation text. */
  about?: ConfirmedFact | null;
}): NarrativeEntry[] {
  return [
    // `about` is the one narrative field a visitor actually reads, so the claim
    // rules matter here more than anywhere else in the brief.
    ...(brief.about ? [{ field: "about", value: brief.about.value }] : []),
    { field: "objective", value: brief.objective.value },
    { field: "audience", value: brief.audience.value },
    { field: "positioning", value: brief.positioning.value },
    { field: "visualDirection", value: brief.visualDirection.value },
    ...(brief.notes ? [{ field: "notes", value: brief.notes.value }] : []),
    ...brief.differentiators.map((fact, index) => ({
      field: `differentiators.${index}`,
      value: fact.value,
    })),
  ];
}

function reportClaimRisks(entries: NarrativeEntry[], ctx: z.RefinementCtx): void {
  for (const risk of findClaimRisks(entries)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: risk.field.split("."),
      message: `Afirmação não sustentada: ${risk.label}`,
    });
  }
}

// ---------------------------------------------------------------------------
// v1 — preservada, porque briefings antigos são imutáveis
// ---------------------------------------------------------------------------

/**
 * The original brief. Kept exactly as it was: a stored version is immutable, so
 * a v1 brief has to keep parsing forever, without being rewritten.
 */
const siteBriefV1Object = z
  .object({
    schemaVersion: z.literal(1),
    ...commonFields,
    services: z.array(shortFactSchema).max(12).default([]),
  })
  .strict();

export type SiteBriefV1 = z.infer<typeof siteBriefV1Object>;

function refineV1(brief: SiteBriefV1, ctx: z.RefinementCtx): void {
  reportClaimRisks(
    [
      ...narrativeEntries(brief),
      ...brief.services.map((fact, index) => ({
        field: `services.${index}`,
        value: fact.value,
      })),
    ],
    ctx,
  );
}

export const siteBriefV1Schema = siteBriefV1Object.superRefine(refineV1);

// ---------------------------------------------------------------------------
// v2 — serviços publicáveis e contato confirmado campo a campo
// ---------------------------------------------------------------------------

const siteBriefV2Object = z
  .object({
    schemaVersion: z.literal(2),
    ...commonFields,
    /**
     * The business presented to its customers, in two to four sentences.
     *
     * The only narrative field written *for the visitor*. `objective` and
     * `audience` describe what the site is for and who it targets — questions
     * an operator answers about the job, not sentences a customer should ever
     * read — and publishing them is how a site ended up telling its own
     * visitors "nicho voltado a restaurante japonês".
     *
     * Nullable with a default so every brief already stored keeps parsing: a
     * brief written before this field existed simply has no presentation text,
     * and the "Sobre" block it would fill is omitted rather than invented.
     */
    about: paragraphFactSchema.nullable().default(null),
    services: z.array(briefServiceSchema).max(40).default([]),
    publicContact: briefPublicContactSchema.default(EMPTY_PUBLIC_CONTACT),
    /**
     * Meta description, confirmed on its own.
     *
     * It exists because the positioning is written for a page and rarely fits
     * the 180 characters a search result allows. Without it the export would
     * either truncate a confirmed sentence — deciding for the operator what to
     * cut — or refuse a perfectly good brief.
     */
    metaDescription: confirmedFactSchema.extend({ value: plainText(180) }).nullable().default(null),
  })
  .strict();

export type SiteBriefV2 = z.infer<typeof siteBriefV2Object>;

function refineV2(brief: SiteBriefV2, ctx: z.RefinementCtx): void {
  {
    reportClaimRisks(
      [
        ...narrativeEntries(brief),
        ...brief.services.flatMap((service, index) => [
          { field: `services.${index}.name`, value: service.name.value },
          { field: `services.${index}.summary`, value: service.summary.value },
          ...service.body.map((paragraph, bodyIndex) => ({
            field: `services.${index}.body.${bodyIndex}`,
            value: paragraph.value,
          })),
        ]),
      ],
      ctx,
    );

    const ids = new Set<string>();
    brief.services.forEach((service, index) => {
      if (ids.has(service.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["services", index, "id"],
          message: `Identificador repetido: ${service.id}`,
        });
      }
      ids.add(service.id);
    });

    brief.services.forEach((service, index) => {
      service.relatedIds.forEach((related, relatedIndex) => {
        if (related === service.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["services", index, "relatedIds", relatedIndex],
            message: "Um serviço não se relaciona consigo mesmo",
          });
          return;
        }
        if (!ids.has(related)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["services", index, "relatedIds", relatedIndex],
            message: `Serviço relacionado inexistente: ${related}`,
          });
        }
      });
    });
  }
}

export const siteBriefV2Schema = siteBriefV2Object.superRefine(refineV2);

// ---------------------------------------------------------------------------
// União
// ---------------------------------------------------------------------------

function withDefaultVersion(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  // v1 stored `schemaVersion` with a default, so old rows may omit it entirely.
  return record.schemaVersion === undefined ? { ...record, schemaVersion: 1 } : record;
}

/**
 * Both versions in one schema.
 *
 * The refinements are applied to the union rather than to each member, because
 * a discriminated union in Zod 3 only accepts plain objects — a `superRefine`
 * wraps a schema in an effect and would be rejected.
 */
export const siteBriefSchema = z.preprocess(
  withDefaultVersion,
  z
    .discriminatedUnion("schemaVersion", [siteBriefV1Object, siteBriefV2Object])
    .superRefine((brief, ctx) => {
      if (brief.schemaVersion === 2) refineV2(brief, ctx);
      else refineV1(brief, ctx);
    }),
);

export type SiteBrief = z.infer<typeof siteBriefSchema>;

export function parseSiteBrief(raw: string): SiteBrief {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Briefing armazenado em formato inválido");
  }
  return siteBriefSchema.parse(value);
}

export function isSiteBriefV2(brief: SiteBrief): brief is SiteBriefV2 {
  return brief.schemaVersion === 2;
}

/** The confirmed public data a brief carries. A v1 brief carries none. */
export function briefPublicContact(brief: SiteBrief): BriefPublicContact {
  return isSiteBriefV2(brief) ? brief.publicContact : EMPTY_PUBLIC_CONTACT;
}

export type BriefCapabilities = {
  schemaVersion: 1 | 2;
  /** True when the brief can produce a service page without invented copy. */
  canGenerateServicePages: boolean;
  /** True when the brief carries confirmed public contact data. */
  hasConfirmedPublicContact: boolean;
  /** What a person has to do before the brief is enough. */
  gaps: string[];
};

/**
 * Reports what a brief can and cannot support.
 *
 * A v1 brief stays readable forever, but it names services without describing
 * them — the generated site would have to invent the copy, which it must not.
 * Saying so explicitly is better than silently producing a site with no service
 * pages.
 */
export function briefCapabilities(brief: SiteBrief): BriefCapabilities {
  const gaps: string[] = [];

  if (!isSiteBriefV2(brief)) {
    if (brief.services.length > 0) {
      gaps.push(
        "O briefing v1 guarda apenas o nome de cada serviço. Migre para a v2 e confirme resumo e conteúdo para gerar as páginas de serviço.",
      );
    }
    gaps.push(
      "O briefing v1 não guarda contato público confirmado. Confirme telefone, WhatsApp, endereço e redes na v2 para que apareçam no site.",
    );

    return {
      schemaVersion: 1,
      canGenerateServicePages: false,
      hasConfirmedPublicContact: false,
      gaps,
    };
  }

  if (brief.services.length === 0) {
    gaps.push("Nenhum serviço confirmado: o site será gerado sem hub e sem páginas de serviço.");
  }

  const contact = brief.publicContact;
  const hasContact = Boolean(
    contact.phone ||
      contact.whatsapp ||
      contact.email ||
      contact.address ||
      contact.socialLinks.length > 0,
  );
  if (!hasContact) {
    gaps.push("Nenhum canal de contato confirmado: o site será gerado sem botões de contato.");
  }

  return {
    schemaVersion: 2,
    canGenerateServicePages: brief.services.length > 0,
    hasConfirmedPublicContact: hasContact,
    gaps,
  };
}
