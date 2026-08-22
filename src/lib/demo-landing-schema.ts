import { z } from "zod";
import { isValidPhoneE164 } from "./phone";

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Preencha este campo")
    .max(max, `Use no máximo ${max} caracteres`)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), {
      message: "O texto contém caracteres de controle inválidos",
    });

const listItem = plainText(180);
const nullablePlainText = (max: number) => plainText(max).nullable();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB");
export const isSafeDemoHttpsUrl = (value: string): boolean => {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
export const isSafeDemoImageUrl = isSafeDemoHttpsUrl;
const httpsUrl = z
  .string()
  .trim()
  .min(1, "Informe a URL da imagem")
  .max(2_000, "Use no máximo 2000 caracteres")
  .refine(isSafeDemoHttpsUrl, { message: "Use uma URL HTTPS válida e sem credenciais" });
const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2_000, "Use no máximo 2000 caracteres")
  .refine((value) => value === "" || isSafeDemoHttpsUrl(value), {
    message: "Use uma URL HTTPS válida e sem credenciais",
  });
const faqItemSchema = z
  .object({
    question: plainText(180),
    answer: plainText(600),
  })
  .strict();
const galleryImageSchema = z
  .object({
    url: httpsUrl,
    alt: plainText(180),
  })
  .strict();
const phoneE164Schema = z
  .string()
  .trim()
  .refine(isValidPhoneE164, { message: "Use um telefone E.164 válido" });

export const demoBusinessSnapshotSchema = z
  .object({
    name: plainText(120),
    category: plainText(120),
    address: nullablePlainText(500),
    neighborhood: nullablePlainText(160),
    city: nullablePlainText(120),
    state: nullablePlainText(64),
    postalCode: nullablePlainText(32),
    phoneE164: phoneE164Schema.nullable(),
    socialLinks: z.array(httpsUrl).max(12),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.latitude === null) !== (value.longitude === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.latitude === null ? "latitude" : "longitude"],
        message: "Informe latitude e longitude juntas",
      });
    }
  });

export type DemoBusinessSnapshot = z.infer<typeof demoBusinessSnapshotSchema>;

const DEFAULT_PROCESS_STEPS = [
  "Encontre as informações essenciais apresentadas nesta página.",
  "Confirme os detalhes diretamente com o estabelecimento.",
  "Decida o próximo passo com base nas informações disponíveis.",
];

export const DEMO_CTA_LABELS = [
  "Ver informações",
  "Conhecer detalhes",
  "Ver dados do estabelecimento",
] as const;

export function normalizeDemoCtaLabel(value: string): (typeof DEMO_CTA_LABELS)[number] {
  return DEMO_CTA_LABELS.find((label) => label === value) ?? DEMO_CTA_LABELS[0];
}

const DEFAULT_FAQS = [
  {
    question: "Como confirmar os detalhes?",
    answer:
      "Consulte diretamente o estabelecimento para validar as informações importantes para a sua necessidade.",
  },
  {
    question: "Esta é a página oficial do estabelecimento?",
    answer:
      "Não. Esta é uma demonstração não oficial criada para apresentar uma possível presença digital.",
  },
];

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
    aboutTitle: plainText(120).default("Sobre"),
    benefits: z.array(listItem).max(8),
    factsTitle: plainText(120).default("Informações essenciais"),
    services: z.array(listItem).max(12),
    servicesTitle: plainText(120).default("Serviços"),
    servicesIntro: plainText(600).default(
      "Consulte o estabelecimento para confirmar os detalhes do que está disponível.",
    ),
    processTitle: plainText(120).default("Como conhecer melhor"),
    processIntro: plainText(600).default(
      "Use as informações disponíveis nesta demonstração como ponto de partida e valide os detalhes antes de tomar uma decisão.",
    ),
    processSteps: z.array(listItem).min(3).max(4).default(DEFAULT_PROCESS_STEPS),
    faqTitle: plainText(120).default("Dúvidas frequentes"),
    faqs: z.array(faqItemSchema).max(6).default(DEFAULT_FAQS),
    finalCtaTitle: plainText(120).default("Próximo passo"),
    finalCtaText: plainText(600).default(
      "Encontre as informações disponíveis e confirme os detalhes diretamente com o estabelecimento.",
    ),
    heroImageUrl: optionalHttpsUrl.default(""),
    galleryTitle: plainText(120).default("Uma presença digital mais completa"),
    galleryIntro: plainText(600).default(
      "Esta seção está pronta para receber fotos oficiais ou autorizadas. Enquanto não houver imagens, a demonstração exibirá composições visuais claramente identificadas como ilustrativas.",
    ),
    galleryImages: z.array(galleryImageSchema).max(6).default([]),
    contactTitle: plainText(120).default("Informações de contato"),
    contactText: plainText(600).default(
      "Valide os canais informados diretamente com o estabelecimento antes de entrar em contato.",
    ),
    businessSnapshot: demoBusinessSnapshotSchema.nullable().default(null),
    ctaLabel: plainText(60),
    primaryColor: hexColor,
    accentColor: hexColor,
  })
  .strict();

type ParsedDemoLandingContent = z.infer<typeof demoLandingContentSchema>;

/** The snapshot is server-managed, so editor clients may omit it from their payload. */
export type DemoLandingContent = Omit<ParsedDemoLandingContent, "businessSnapshot"> & {
  businessSnapshot?: DemoBusinessSnapshot | null;
};

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
