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
 * Versioned, factual input for a generated site. Contact data deliberately is
 * not copied into the brief; renderers resolve it from the linked Business.
 */
export const siteBriefSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    businessName: shortFactSchema,
    sector: shortFactSchema,
    city: shortFactSchema.nullable().default(null),
    objective: paragraphFactSchema,
    audience: paragraphFactSchema,
    positioning: paragraphFactSchema,
    services: z.array(shortFactSchema).max(12).default([]),
    differentiators: z.array(shortFactSchema).max(8).default([]),
    desiredSections: z.array(plainText(80)).min(1).max(12),
    visualDirection: paragraphFactSchema,
    notes: paragraphFactSchema.nullable().default(null),
  })
  .strict()
  .superRefine((brief, ctx) => {
    const entries = [
      ["objective", brief.objective.value],
      ["audience", brief.audience.value],
      ["positioning", brief.positioning.value],
      ["visualDirection", brief.visualDirection.value],
      ...(brief.notes ? [["notes", brief.notes.value]] : []),
      ...brief.services.map((fact, index) => [`services.${index}`, fact.value]),
      ...brief.differentiators.map((fact, index) => [`differentiators.${index}`, fact.value]),
    ].map(([field, value]) => ({ field, value }));

    for (const risk of findClaimRisks(entries)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: risk.field.split("."),
        message: `Afirmação não sustentada: ${risk.label}`,
      });
    }
  });

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
