import { randomBytes } from "node:crypto";
import type { DemoLanding } from "@prisma/client";
import {
  demoLandingContentSchema,
  demoLandingStatusSchema,
  parseDemoLandingContent,
  type DemoLandingContent,
} from "./demo-landing-schema";

export type DemoLeadInput = {
  name: string;
  category: string;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  phoneE164?: string | null;
};

type CategoryTemplate = {
  keywords: string[];
  context: string;
  primaryColor: string;
  accentColor: string;
};

const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  {
    keywords: ["restaurante", "lanchonete", "cafeteria", "padaria", "alimenta", "comida"],
    context: "Uma apresentação digital pensada para negócios de alimentação.",
    primaryColor: "#dc2626",
    accentColor: "#f59e0b",
  },
  {
    keywords: ["barbear", "salao", "beleza", "estetica", "cabeleire"],
    context: "Uma apresentação digital pensada para beleza e cuidados pessoais.",
    primaryColor: "#be185d",
    accentColor: "#a855f7",
  },
  {
    keywords: ["academia", "fitness", "pilates", "estudio", "esporte"],
    context: "Uma apresentação digital pensada para atividade física e bem-estar.",
    primaryColor: "#15803d",
    accentColor: "#22c55e",
  },
  {
    keywords: ["pet", "veterinar", "animal"],
    context: "Uma apresentação digital pensada para negócios do segmento pet.",
    primaryColor: "#0f766e",
    accentColor: "#2dd4bf",
  },
  {
    keywords: ["oficina", "automot", "mecanica", "veiculo"],
    context: "Uma apresentação digital pensada para o setor automotivo.",
    primaryColor: "#334155",
    accentColor: "#f97316",
  },
  {
    keywords: ["escola", "curso", "educa", "ensino"],
    context: "Uma apresentação digital pensada para educação e aprendizagem.",
    primaryColor: "#1d4ed8",
    accentColor: "#38bdf8",
  },
  {
    keywords: ["clinica", "consultorio", "dent", "saude", "medic"],
    context: "Uma apresentação digital pensada para negócios da área de saúde.",
    primaryColor: "#0369a1",
    accentColor: "#22d3ee",
  },
  {
    keywords: ["hotel", "pousada", "turismo", "hosped"],
    context: "Uma apresentação digital pensada para turismo e hospedagem.",
    primaryColor: "#0f766e",
    accentColor: "#fbbf24",
  },
  {
    keywords: ["imobili", "advoc", "contabil", "escritorio", "profission"],
    context: "Uma apresentação digital pensada para serviços profissionais.",
    primaryColor: "#4338ca",
    accentColor: "#a78bfa",
  },
  {
    keywords: ["loja", "comercio", "varejo", "roupa", "move", "eletronic"],
    context: "Uma apresentação digital pensada para comércio local.",
    primaryColor: "#7c3aed",
    accentColor: "#ec4899",
  },
];

const FALLBACK_TEMPLATE: CategoryTemplate = {
  keywords: [],
  context: "Uma apresentação digital pensada para um negócio local.",
  primaryColor: "#6d28d9",
  accentColor: "#06b6d4",
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function selectTemplate(category: string): CategoryTemplate {
  const normalized = normalizeText(category);
  return (
    CATEGORY_TEMPLATES.find((template) =>
      template.keywords.some((keyword) => normalized.includes(keyword)),
    ) ?? FALLBACK_TEMPLATE
  );
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function safeLeadText(value: string | null | undefined, max: number, fallback = ""): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim() || fallback;
  return normalized.slice(0, max).trim();
}

function displayLocation(lead: DemoLeadInput): string | null {
  const city = safeLeadText(lead.city, 72);
  const state = safeLeadText(lead.state, 24);
  const cityAndState = compact([city, state]).join(" — ");
  return cityAndState || safeLeadText(lead.neighborhood, 96) || null;
}

/**
 * Produces only copy grounded in fields that are present on the lead. In
 * particular, services starts empty and the generator has no reviews, prices or
 * opening-hour inputs.
 */
export function generateDemoLandingContent(lead: DemoLeadInput): DemoLandingContent {
  const name = safeLeadText(lead.name, 92, "Negócio local");
  const category = safeLeadText(lead.category, 110, "Serviços locais");
  const location = displayLocation(lead);
  const template = selectTemplate(category);
  const neighborhood = safeLeadText(lead.neighborhood, 96);

  const knownFacts = compact([
    `Categoria cadastrada: ${category}`,
    location ? `Localização informada: ${location}` : null,
    neighborhood ? `Bairro informado: ${neighborhood}` : null,
    lead.address ? "Endereço cadastrado" : null,
    lead.phoneE164 ? "Contato telefônico disponível" : null,
  ]).slice(0, 5);

  const locationSentence = location ? ` com localização informada em ${location}` : "";

  return demoLandingContentSchema.parse({
    headline: `Conheça ${name}`,
    subheadline: `${category}${location ? ` em ${location}` : ""}. ${template.context}`,
    about: `${name} está cadastrado na categoria ${category}${locationSentence}. Esta demonstração mostra como as informações confirmadas do estabelecimento podem ser organizadas em uma página clara e acessível.`,
    benefits: knownFacts,
    services: [],
    ctaLabel: "Ver informações",
    primaryColor: template.primaryColor,
    accentColor: template.accentColor,
  });
}

export function slugifyDemoName(name: string): string {
  const slug = normalizeText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "empresa";
}

/** 96 random bits by default; the optional entropy makes the helper testable. */
export function createDemoSlug(name: string, entropy?: string): string {
  const suffix = entropy ?? randomBytes(12).toString("hex");
  if (!/^[a-zA-Z0-9_-]{12,64}$/.test(suffix)) {
    throw new Error("Entropia inválida para o endereço da demonstração");
  }
  return `${slugifyDemoName(name)}-${suffix.toLowerCase()}`;
}

export function demoExpiryDate(days: number, from = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
  return expiresAt;
}

export function isDemoLandingExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export type DemoLandingDto = {
  id: string;
  leadId: string;
  slug: string;
  status: "DRAFT" | "APPROVED" | "EXPIRED";
  content: DemoLandingContent;
  expiresAt: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
};

export function toDemoLandingDto(landing: DemoLanding, origin: string): DemoLandingDto {
  const status = demoLandingStatusSchema.parse(landing.status);
  return {
    id: landing.id,
    leadId: landing.businessId,
    slug: landing.slug,
    status,
    content: parseDemoLandingContent(landing.contentJson),
    expiresAt: landing.expiresAt.toISOString(),
    approvedAt: landing.approvedAt?.toISOString() ?? null,
    createdAt: landing.createdAt.toISOString(),
    updatedAt: landing.updatedAt.toISOString(),
    previewUrl: new URL(`/demo/${landing.slug}`, origin).toString(),
  };
}
