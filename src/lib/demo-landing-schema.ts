import { z } from "zod";

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
      message: "O texto contém caracteres de controle inválidos",
    });

const listItem = plainText(180);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB");

/**
 * Deliberately small content contract for the public demo.
 * There are no review, price or opening-hour fields, so the automatic generator
 * cannot manufacture those claims.
 */
export const demoLandingContentSchema = z
  .object({
    headline: plainText(120),
    subheadline: plainText(320),
    about: plainText(1_200),
    benefits: z.array(listItem).max(8),
    services: z.array(listItem).max(12),
    ctaLabel: plainText(60),
    primaryColor: hexColor,
    accentColor: hexColor,
  })
  .strict();

export type DemoLandingContent = z.infer<typeof demoLandingContentSchema>;

export const DEMO_LANDING_STATUSES = ["DRAFT", "APPROVED", "EXPIRED"] as const;
export const demoLandingStatusSchema = z.enum(DEMO_LANDING_STATUSES);
export type DemoLandingStatus = z.infer<typeof demoLandingStatusSchema>;

export const createDemoLandingSchema = z
  .object({
    leadId: z.string().trim().min(1).max(128),
    expiresInDays: z.number().int().min(1).max(90).default(14),
  })
  .strict();

export const updateDemoLandingSchema = z
  .object({
    content: demoLandingContentSchema.optional(),
    status: demoLandingStatusSchema.optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (value) => value.content !== undefined || value.status !== undefined || value.expiresAt !== undefined,
    { message: "Informe ao menos um campo para atualizar" },
  );

export function parseDemoLandingContent(raw: string): DemoLandingContent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Conteúdo da demonstração armazenado em formato inválido");
  }
  return demoLandingContentSchema.parse(value);
}
