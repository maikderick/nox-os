import { z } from "zod";
import {
  DEMO_CTA_LABELS,
  demoFaqItemSchema,
  demoHexColorSchema,
  demoLandingContentSchema,
  demoListItemSchema,
  demoPlainText,
  normalizeDemoCtaLabel,
  type DemoLandingContent,
} from "./demo-landing-schema";

/**
 * The only fields Claude may rewrite. Everything outside this list — the business
 * snapshot, image URLs, slug, validity and approval state — stays under the
 * control of the free generator and of the human reviewer.
 */
export const DEMO_AI_EDITORIAL_FIELDS = [
  "headline",
  "subheadline",
  "aboutTitle",
  "about",
  "factsTitle",
  "benefits",
  "servicesTitle",
  "servicesIntro",
  "services",
  "galleryTitle",
  "galleryIntro",
  "processTitle",
  "processIntro",
  "processSteps",
  "faqTitle",
  "faqs",
  "contactTitle",
  "contactText",
  "finalCtaTitle",
  "finalCtaText",
  "ctaLabel",
  "primaryColor",
  "accentColor",
] as const;

export type DemoAiEditorialField = (typeof DEMO_AI_EDITORIAL_FIELDS)[number];

/** Fields the assisted draft can never reach, kept explicit for tests and review. */
export const DEMO_AI_PROTECTED_FIELDS = [
  "businessSnapshot",
  "heroImageUrl",
  "heroImageKind",
  "heroImageCredit",
  "heroImageCreditUrl",
  "galleryImages",
] as const;

/**
 * Mirrors the public content limits exactly. Every field is required so a
 * truncated or partial answer fails validation instead of silently falling back
 * to defaults that would erase reviewed copy.
 */
export const demoLandingAiDraftSchema = z
  .object({
    headline: demoPlainText(120),
    subheadline: demoPlainText(320),
    aboutTitle: demoPlainText(120),
    about: demoPlainText(1_200),
    factsTitle: demoPlainText(120),
    benefits: z.array(demoListItemSchema).max(8),
    servicesTitle: demoPlainText(120),
    servicesIntro: demoPlainText(600),
    services: z.array(demoListItemSchema).max(12),
    galleryTitle: demoPlainText(120),
    galleryIntro: demoPlainText(600),
    processTitle: demoPlainText(120),
    processIntro: demoPlainText(600),
    processSteps: z.array(demoListItemSchema).min(3).max(4),
    faqTitle: demoPlainText(120),
    faqs: z.array(demoFaqItemSchema).max(6),
    contactTitle: demoPlainText(120),
    contactText: demoPlainText(600),
    finalCtaTitle: demoPlainText(120),
    finalCtaText: demoPlainText(600),
    ctaLabel: z.enum(DEMO_CTA_LABELS),
    primaryColor: demoHexColorSchema,
    accentColor: demoHexColorSchema,
  })
  .strict();

export type DemoLandingAiDraft = z.infer<typeof demoLandingAiDraftSchema>;

/** JSON Schema handed to the Messages API so the answer arrives already shaped. */
export function buildDemoAiJsonSchema(): Record<string, unknown> {
  const listOf = (maxItems: number, minItems = 0) => ({
    type: "array",
    minItems,
    maxItems,
    items: { type: "string", minLength: 1, maxLength: 180 },
  });
  const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });

  return {
    type: "object",
    additionalProperties: false,
    required: [...DEMO_AI_EDITORIAL_FIELDS],
    properties: {
      headline: text(120),
      subheadline: text(320),
      aboutTitle: text(120),
      about: text(1_200),
      factsTitle: text(120),
      benefits: listOf(8),
      servicesTitle: text(120),
      servicesIntro: text(600),
      services: listOf(12),
      galleryTitle: text(120),
      galleryIntro: text(600),
      processTitle: text(120),
      processIntro: text(600),
      processSteps: listOf(4, 3),
      faqTitle: text(120),
      faqs: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "answer"],
          properties: { question: text(180), answer: text(600) },
        },
      },
      contactTitle: text(120),
      contactText: text(600),
      finalCtaTitle: text(120),
      finalCtaText: text(600),
      ctaLabel: { type: "string", enum: [...DEMO_CTA_LABELS] },
      primaryColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    },
  };
}

function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type FabricationRule = {
  id: string;
  label: string;
  pattern: RegExp;
};

/**
 * Last line of defence against invented facts. The system prompt already forbids
 * them; this check refuses the answer when the model states something the lead
 * record cannot back up.
 */
const FABRICATION_RULES: FabricationRule[] = [
  {
    id: "contato",
    label: "telefone, documento ou sequência numérica de contato",
    pattern: /\d(?:[\s().-]*\d){7,}/,
  },
  {
    id: "email",
    label: "endereço de e-mail",
    pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/,
  },
  { id: "link", label: "endereço de site ou imagem", pattern: /https?:\/\/|www\./ },
  {
    id: "avaliacao",
    label: "avaliação, nota ou estrelas",
    pattern: /★|⭐|\b(avaliac|estrela|reviews?\b|nota\s*\d|classificac|bem avaliad)/,
  },
  {
    id: "depoimento",
    label: "depoimento ou fala de cliente",
    pattern:
      /\b(depoiment|testemunh|clientes? (dizem|adoram|amam|aprovam|elogiam)|feedback dos clientes)/,
  },
  {
    id: "premio",
    label: "prêmio, certificação ou selo",
    pattern: /\b(premi(o|os|ada|ado|ados)|galardo|certificad|selo de qualidade|reconhecid[oa] como)/,
  },
  {
    id: "preco",
    label: "preço, promoção ou condição comercial",
    pattern:
      /(r\$|\bprec(o|os)\b|\bvalor(es)? a partir|\bpromoc|\bdesconto|\bgratis\b|\bgratuit|\bparcelament|\ba partir de\b|\d+\s*%|\bcupom|\borcamento sem custo)/,
  },
  {
    id: "horario",
    label: "horário de funcionamento",
    pattern:
      /\b(horario|funcionament|aberto (de|das|todos)|\d{1,2}\s*h(oras)?\b|\d{1,2}\s*:\s*\d{2}|segunda a (sexta|sabado|domingo)|24\s*horas|plantao|atendimento (das|de) \d)/,
  },
  {
    id: "experiencia",
    label: "tempo de mercado, volume de clientes ou histórico",
    pattern:
      /\b(anos de (experiencia|mercado|atuacao|tradicao|historia)|desde \d{4}|fundad[oa]|ha (mais de )?\d+ anos|mais de \d+\s*(anos|clientes|atendimentos|pacientes|alunos)|\d+\s*\+?\s*(clientes|atendimentos|pacientes|alunos))/,
  },
  {
    id: "garantia",
    label: "garantia ou promessa de resultado",
    pattern:
      /\b(garant(ia|ias|imos|ido|ida)|sem risco|100\s*%|\bcura\b|tratamento eficaz|comprovad|cientificamente|aprovado pela anvisa|resultado assegurado)/,
  },
  {
    id: "superlativo",
    label: "superlativo sem comprovação",
    pattern:
      /\b(o melhor|a melhor|os melhores|as melhores|numero 1|n[.ºo°]?\s*1\b|lider (de|do|em|no|na)|referencia (em|na|no) |imbativel|insuperavel)/,
  },
  {
    id: "equipe",
    label: "qualificação de equipe não confirmada",
    pattern: /\b(equipe (altamente )?(qualificada|especializada|certificada|treinada)|especialistas certificados|profissionais premiados)/,
  },
];

export type FabricationRisk = {
  rule: string;
  label: string;
  field: string;
  sample: string;
};

function collectDraftText(draft: DemoLandingAiDraft): Array<{ field: string; value: string }> {
  const entries: Array<{ field: string; value: string }> = [];

  for (const field of DEMO_AI_EDITORIAL_FIELDS) {
    if (field === "primaryColor" || field === "accentColor") continue;
    const value = draft[field];
    if (typeof value === "string") {
      entries.push({ field, value });
      continue;
    }
    if (!Array.isArray(value)) continue;

    value.forEach((item, index) => {
      if (typeof item === "string") {
        entries.push({ field: `${field}[${index}]`, value: item });
        return;
      }
      entries.push({ field: `${field}[${index}].question`, value: item.question });
      entries.push({ field: `${field}[${index}].answer`, value: item.answer });
    });
  }

  return entries;
}

export function findFabricationRisks(draft: DemoLandingAiDraft): FabricationRisk[] {
  const risks: FabricationRisk[] = [];

  for (const entry of collectDraftText(draft)) {
    const normalized = normalizeForMatching(entry.value);
    for (const rule of FABRICATION_RULES) {
      if (!rule.pattern.test(normalized)) continue;
      risks.push({
        rule: rule.id,
        label: rule.label,
        field: entry.field,
        sample: entry.value.slice(0, 120),
      });
    }
  }

  return risks;
}

export type DemoAiMergeResult = {
  content: DemoLandingContent;
  droppedServices: string[];
  changedFields: DemoAiEditorialField[];
};

/**
 * Applies only the allowlisted editorial fields on top of the reviewed content.
 * Services are intersected with the ones already confirmed on the demo, so the
 * model can reorder or drop them but never introduce a new offer.
 */
export function mergeDemoAiDraft(params: {
  current: DemoLandingContent;
  draft: DemoLandingAiDraft;
}): DemoAiMergeResult {
  const { current, draft } = params;

  const confirmedServices = new Map(
    current.services.map((service) => [normalizeForMatching(service), service]),
  );
  const droppedServices: string[] = [];
  const services: string[] = [];

  for (const service of draft.services) {
    const confirmed = confirmedServices.get(normalizeForMatching(service));
    if (!confirmed) {
      droppedServices.push(service);
      continue;
    }
    if (!services.includes(confirmed)) services.push(confirmed);
  }

  const content = demoLandingContentSchema.parse({
    ...current,
    headline: draft.headline,
    subheadline: draft.subheadline,
    aboutTitle: draft.aboutTitle,
    about: draft.about,
    factsTitle: draft.factsTitle,
    benefits: draft.benefits,
    servicesTitle: draft.servicesTitle,
    servicesIntro: draft.servicesIntro,
    services,
    galleryTitle: draft.galleryTitle,
    galleryIntro: draft.galleryIntro,
    processTitle: draft.processTitle,
    processIntro: draft.processIntro,
    processSteps: draft.processSteps,
    faqTitle: draft.faqTitle,
    faqs: draft.faqs,
    contactTitle: draft.contactTitle,
    contactText: draft.contactText,
    finalCtaTitle: draft.finalCtaTitle,
    finalCtaText: draft.finalCtaText,
    ctaLabel: normalizeDemoCtaLabel(draft.ctaLabel),
    primaryColor: draft.primaryColor,
    accentColor: draft.accentColor,
    // Protected: never taken from the model.
    heroImageUrl: current.heroImageUrl,
    heroImageKind: current.heroImageKind,
    heroImageCredit: current.heroImageCredit,
    heroImageCreditUrl: current.heroImageCreditUrl,
    galleryImages: current.galleryImages,
    businessSnapshot: current.businessSnapshot ?? null,
  });

  const changedFields = DEMO_AI_EDITORIAL_FIELDS.filter(
    (field) => JSON.stringify(content[field]) !== JSON.stringify(current[field]),
  );

  return { content, droppedServices, changedFields };
}

/**
 * Facts handed to the model. Contact details are reduced to booleans: the copy
 * must never repeat a phone number or address, and the page renders those from
 * the protected snapshot anyway.
 */
export type DemoAiFacts = {
  name: string;
  category: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  hasPhone: boolean;
  hasAddress: boolean;
  hasMap: boolean;
  socialLinkCount: number;
  confirmedServices: string[];
  officialPhotoCount: number;
};

export function buildDemoAiFacts(content: DemoLandingContent): DemoAiFacts {
  const snapshot = content.businessSnapshot ?? null;

  return {
    name: snapshot?.name ?? "",
    category: snapshot?.category ?? "",
    neighborhood: snapshot?.neighborhood ?? null,
    city: snapshot?.city ?? null,
    state: snapshot?.state ?? null,
    hasPhone: Boolean(snapshot?.phoneE164),
    hasAddress: Boolean(snapshot?.address),
    hasMap: snapshot?.latitude !== null && snapshot?.latitude !== undefined,
    socialLinkCount: snapshot?.socialLinks.length ?? 0,
    confirmedServices: content.services,
    officialPhotoCount: content.galleryImages.length,
  };
}

export const DEMO_AI_SYSTEM_PROMPT = [
  "Você é redator de landing pages demonstrativas da NOX OS, em português do Brasil.",
  "A página é uma DEMONSTRAÇÃO NÃO OFICIAL de uma empresa que ainda não tem site.",
  "",
  "Sua tarefa: melhorar apenas o texto editorial (títulos, textos, benefícios, etapas, FAQ, chamadas e cores).",
  "",
  "REGRAS ABSOLUTAS — quebrar qualquer uma invalida a resposta inteira:",
  "1. Use somente os fatos confirmados fornecidos. Nada além disso existe.",
  "2. NUNCA invente nem mencione: avaliações, notas, estrelas, depoimentos, número de clientes,",
  "   prêmios, certificações, preços, promoções, descontos, horários de funcionamento,",
  "   tempo de mercado, ano de fundação, garantias ou resultados prometidos.",
  "3. NUNCA escreva telefones, e-mails, endereços, URLs ou nomes de redes sociais no texto.",
  "   Esses dados são renderizados automaticamente a partir de um cadastro protegido.",
  "4. Serviços: use apenas os serviços confirmados recebidos. Se a lista vier vazia, devolva",
  "   uma lista vazia e escreva a introdução de serviços sem citar serviço algum.",
  "5. Sem superlativos não comprováveis ('o melhor', 'líder', 'referência', 'nº 1').",
  "6. Sem afirmações médicas, jurídicas, financeiras ou comerciais.",
  "7. Não prometa entrega, atendimento, disponibilidade ou qualquer condição.",
  "",
  "Como escrever bem dentro dessas regras:",
  "- Frases claras, específicas e humanas; nada de jargão publicitário vazio.",
  "- O título principal deve conter ou evocar o nome da empresa.",
  "- Benefícios devem descrever o que a página oferece ao visitante ou fatos do cadastro,",
  "  nunca vantagens comerciais inventadas.",
  "- A FAQ deve responder dúvidas que os fatos disponíveis conseguem responder, e ao menos",
  "  uma pergunta deve deixar claro que esta é uma demonstração não oficial.",
  "- As cores devem combinar com o segmento e manter bom contraste sobre fundo escuro (#07070a).",
  "",
  "Responda apenas com o JSON no formato solicitado.",
].join("\n");

export function buildDemoAiUserPrompt(params: {
  facts: DemoAiFacts;
  current: DemoLandingContent;
  corrections?: string[];
}): string {
  const { facts, current, corrections = [] } = params;

  const location = [facts.neighborhood, facts.city, facts.state].filter(Boolean).join(", ");
  const factLines = [
    `Nome: ${facts.name}`,
    `Categoria: ${facts.category}`,
    location ? `Localização informada: ${location}` : "Localização: não informada",
    `Telefone cadastrado: ${facts.hasPhone ? "sim (não escreva o número)" : "não"}`,
    `Endereço cadastrado: ${facts.hasAddress ? "sim (não escreva o endereço)" : "não"}`,
    `Mapa disponível: ${facts.hasMap ? "sim" : "não"}`,
    `Redes sociais cadastradas: ${facts.socialLinkCount}`,
    `Fotos oficiais já cadastradas: ${facts.officialPhotoCount}`,
    facts.confirmedServices.length
      ? `Serviços confirmados: ${facts.confirmedServices.join(" | ")}`
      : "Serviços confirmados: nenhum (devolva services como lista vazia)",
  ];

  const currentContent = JSON.stringify(
    Object.fromEntries(
      DEMO_AI_EDITORIAL_FIELDS.map((field) => [field, current[field]]),
    ),
    null,
    2,
  );

  const blocks = [
    "FATOS CONFIRMADOS DO CADASTRO (única fonte de verdade):",
    factLines.join("\n"),
    "",
    "CONTEÚDO EDITORIAL ATUAL (gerado automaticamente, para você melhorar):",
    currentContent,
    "",
    "Devolva o JSON completo com todos os campos melhorados.",
  ];

  if (corrections.length) {
    blocks.push(
      "",
      "A tentativa anterior foi rejeitada pela validação automática. Corrija e reescreva:",
      corrections.map((item) => `- ${item}`).join("\n"),
    );
  }

  return blocks.join("\n");
}

export type DemoAiValidation =
  | { ok: true; draft: DemoLandingAiDraft }
  | { ok: false; corrections: string[] };

/** Validates a raw model answer against the schema and the fabrication rules. */
export function validateDemoAiDraft(raw: unknown): DemoAiValidation {
  const parsed = demoLandingAiDraftSchema.safeParse(raw);
  if (!parsed.success) {
    const corrections = parsed.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.join(".") || "raiz";
      return `Campo ${path}: ${issue.message}`;
    });
    return { ok: false, corrections };
  }

  const risks = findFabricationRisks(parsed.data);
  if (risks.length) {
    const corrections = risks
      .slice(0, 8)
      .map((risk) => `Campo ${risk.field} contém ${risk.label}. Reescreva sem esse conteúdo.`);
    return { ok: false, corrections };
  }

  return { ok: true, draft: parsed.data };
}
