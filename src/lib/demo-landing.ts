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
    `Categoria: ${category}`,
    location ? `Localização: ${location}` : null,
    neighborhood && neighborhood !== location ? `Bairro: ${neighborhood}` : null,
    lead.address ? "Endereço informado" : null,
  ]).slice(0, 5);

  const locationSentence = location ? ` e tem localização informada em ${location}` : "";
  const processLocationStep = location
    ? `Confira a localização informada em ${location}.`
    : "Confirme a localização diretamente com o estabelecimento.";
  const faqs = [
    {
      question: "Em qual categoria atua?",
      answer: `${name} atua na categoria ${category}.`,
    },
    ...(location
      ? [
          {
            question: "Qual é a localização informada?",
            answer: `A localização informada de ${name} é ${location}.`,
          },
        ]
      : []),
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

  return demoLandingContentSchema.parse({
    headline: `Conheça ${name}`,
    subheadline: `${category}${location ? ` em ${location}` : ""}. ${template.context}`,
    about: `${name} atua na categoria ${category}${locationSentence}. Esta demonstração reúne as informações essenciais do estabelecimento em uma página clara e acessível.`,
    aboutTitle: `Sobre ${name}`,
    benefits: knownFacts,
    factsTitle: "Informações essenciais",
    services: [],
    servicesTitle: "Serviços",
    servicesIntro: `${name} atua na categoria ${category}. Consulte o estabelecimento para confirmar os detalhes do que está disponível.`,
    processTitle: `Como conhecer ${name}`,
    processIntro:
      "Encontre as informações essenciais e verifique os detalhes importantes antes de decidir.",
    processSteps: [
      `Confira a atuação na categoria ${category}.`,
      processLocationStep,
      "Confirme diretamente os detalhes importantes para a sua necessidade.",
    ],
    faqTitle: "Dúvidas frequentes",
    faqs,
    finalCtaTitle: `Conheça melhor ${name}`,
    finalCtaText:
      "Use as informações disponíveis nesta prévia como ponto de partida e valide os detalhes diretamente com o estabelecimento.",
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
