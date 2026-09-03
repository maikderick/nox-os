import type { DemoLeadInput } from "./demo-landing";
import { createDemoBusinessSnapshot } from "./demo-landing";
import { demoLandingContentSchema, type DemoLandingContent } from "./demo-landing-schema";
import { isValidPhoneE164 } from "./phone";
import type { SiteBriefV2 } from "./site-factory/brief-schema";

/**
 * Builds the public site content from a confirmed v2 brief.
 *
 * Every sentence here is either a confirmed fact from the brief (name, sector,
 * positioning, audience, differentiators, services, contact) or neutral
 * sector wording that asserts nothing about quality, price, reviews, hours or
 * history. The claim rules in `content-integrity` stay the last line of
 * defence; this module simply never produces anything they would flag.
 */

export type SectorFamily =
  | "food"
  | "beauty"
  | "health"
  | "fitness"
  | "pet"
  | "auto"
  | "education"
  | "hospitality"
  | "professional"
  | "retail"
  | "home"
  | "default";

type FamilyProfile = {
  keywords: string[];
  servicesTitle: string;
  processTitle: string;
  /** Verb phrase used in copy: "pedir", "agendar", "solicitar um orçamento". */
  action: string;
  /** What the customer gets at the end of the process step. */
  outcome: string;
  ctaWhatsApp: string;
  finalCtaTitle: string;
  tagline: string;
  primary: string;
  accent: string;
};

const FAMILIES: Record<SectorFamily, FamilyProfile> = {
  food: {
    keywords: ["hamburg", "pizza", "lanch", "restaur", "cafeter", "cafe", "padar", "confeit", "docer", "aliment", "comida", "sorvet", "acai", "marmit", "bar ", "churras", "sushi", "food"],
    servicesTitle: "Cardápio",
    processTitle: "Como pedir",
    action: "pedir",
    outcome: "Receba em casa ou retire no balcão, como combinar na conversa.",
    ctaWhatsApp: "Pedir no WhatsApp",
    finalCtaTitle: "Faça seu pedido pelo WhatsApp",
    tagline: "Cardápio, endereço e pedido em um só lugar.",
    primary: "#dc2626",
    accent: "#f59e0b",
  },
  beauty: {
    keywords: ["barbear", "barbeir", "salao", "cabele", "estetic", "beleza", "manicure", "sobrancel", "cilios", "maquiag", "spa", "depila"],
    servicesTitle: "Serviços",
    processTitle: "Como agendar",
    action: "agendar",
    outcome: "Chegue no horário combinado e seja atendido sem espera.",
    ctaWhatsApp: "Agendar pelo WhatsApp",
    finalCtaTitle: "Agende seu horário pelo WhatsApp",
    tagline: "Serviços, horários e agendamento em um só lugar.",
    primary: "#be185d",
    accent: "#f472b6",
  },
  health: {
    keywords: ["clinic", "consult", "odont", "dent", "medic", "saude", "fisio", "psic", "nutri", "terap", "labor", "otica", "farmac"],
    servicesTitle: "Especialidades e atendimentos",
    processTitle: "Como agendar uma consulta",
    action: "agendar",
    outcome: "Compareça no dia e horário confirmados com seus documentos.",
    ctaWhatsApp: "Agendar pelo WhatsApp",
    finalCtaTitle: "Agende sua consulta",
    tagline: "Atendimentos, endereço e agendamento com facilidade.",
    primary: "#0369a1",
    accent: "#22d3ee",
  },
  fitness: {
    keywords: ["academ", "fitness", "crossfit", "pilates", "personal", "muscula", "yoga", "luta", "nata", "danca"],
    servicesTitle: "Modalidades e planos",
    processTitle: "Como começar",
    action: "agendar uma visita",
    outcome: "Conheça o espaço e comece no plano que fizer sentido para você.",
    ctaWhatsApp: "Falar no WhatsApp",
    finalCtaTitle: "Dê o primeiro passo hoje",
    tagline: "Modalidades, horários e matrícula sem complicação.",
    primary: "#15803d",
    accent: "#4ade80",
  },
  pet: {
    keywords: ["pet", "veterin", "animal", "banho e tosa", "racao"],
    servicesTitle: "Serviços",
    processTitle: "Como agendar",
    action: "agendar",
    outcome: "Traga seu pet no horário combinado e acompanhe o atendimento.",
    ctaWhatsApp: "Agendar pelo WhatsApp",
    finalCtaTitle: "Agende o atendimento do seu pet",
    tagline: "Cuidado para o seu pet, com agendamento pelo WhatsApp.",
    primary: "#0f766e",
    accent: "#2dd4bf",
  },
  auto: {
    keywords: ["mecanic", "auto", "oficina", "automot", "lava", "funilar", "borrach", "pneu", "veicul", "carro", "moto"],
    servicesTitle: "Serviços",
    processTitle: "Como funciona",
    action: "solicitar um orçamento",
    outcome: "Leve o veículo no horário combinado e acompanhe o serviço.",
    ctaWhatsApp: "Pedir orçamento",
    finalCtaTitle: "Peça um orçamento pelo WhatsApp",
    tagline: "Serviços para o seu veículo, com orçamento pelo WhatsApp.",
    primary: "#334155",
    accent: "#f97316",
  },
  education: {
    keywords: ["escola", "curso", "educa", "ensino", "idioma", "reforc", "aula", "faculdade", "creche"],
    servicesTitle: "Cursos e turmas",
    processTitle: "Como se matricular",
    action: "pedir informações",
    outcome: "Escolha a turma e finalize a matrícula com a equipe.",
    ctaWhatsApp: "Falar no WhatsApp",
    finalCtaTitle: "Tire suas dúvidas sobre matrícula",
    tagline: "Cursos, turmas e matrícula em um só lugar.",
    primary: "#1d4ed8",
    accent: "#38bdf8",
  },
  hospitality: {
    keywords: ["hotel", "pousad", "hosped", "hostel", "turis", "chale", "resort"],
    servicesTitle: "Acomodações e serviços",
    processTitle: "Como reservar",
    action: "reservar",
    outcome: "Receba a confirmação e as orientações de chegada na conversa.",
    ctaWhatsApp: "Reservar pelo WhatsApp",
    finalCtaTitle: "Faça sua reserva pelo WhatsApp",
    tagline: "Acomodações, localização e reserva direta.",
    primary: "#0f766e",
    accent: "#fbbf24",
  },
  professional: {
    keywords: ["advoc", "advog", "jurid", "contab", "contad", "seguro", "corret", "imobil", "imove", "consult", "escritor", "arquitet", "engenh", "design", "marketing", "agencia"],
    servicesTitle: "Áreas de atuação",
    processTitle: "Como funciona o atendimento",
    action: "agendar uma conversa",
    outcome: "Receba uma proposta clara e decida com tranquilidade.",
    ctaWhatsApp: "Falar no WhatsApp",
    finalCtaTitle: "Vamos conversar sobre o seu caso",
    tagline: "Atuação, forma de trabalho e contato direto.",
    primary: "#4338ca",
    accent: "#a78bfa",
  },
  retail: {
    keywords: ["loja", "varejo", "roupa", "moda", "boutique", "movei", "eletron", "celular", "papelar", "livrar", "mercado", "merce", "hortifrut", "floric", "otica", "joalh", "bijut", "presente"],
    servicesTitle: "Produtos",
    processTitle: "Como comprar",
    action: "pedir",
    outcome: "Combine retirada ou entrega direto na conversa.",
    ctaWhatsApp: "Comprar pelo WhatsApp",
    finalCtaTitle: "Compre pelo WhatsApp",
    tagline: "Produtos, endereço e atendimento pelo WhatsApp.",
    primary: "#7c3aed",
    accent: "#ec4899",
  },
  home: {
    keywords: ["ar-cond", "ar cond", "refriger", "climat", "assist", "conserto", "reparo", "limpeza", "dedetiz", "constru", "reforma", "marcen", "serralh", "eletric", "encanad", "pintur", "piscina", "jardin", "vidrac", "chaveir", "mudanc"],
    servicesTitle: "Serviços",
    processTitle: "Como solicitar um orçamento",
    action: "solicitar um orçamento",
    outcome: "Receba o orçamento e agende a execução do serviço.",
    ctaWhatsApp: "Pedir orçamento",
    finalCtaTitle: "Peça um orçamento pelo WhatsApp",
    tagline: "Serviços, atendimento na região e orçamento pelo WhatsApp.",
    primary: "#0e7490",
    accent: "#facc15",
  },
  default: {
    keywords: [],
    servicesTitle: "Serviços",
    processTitle: "Como funciona",
    action: "falar com a gente",
    outcome: "Combine os detalhes e o próximo passo direto na conversa.",
    ctaWhatsApp: "Falar no WhatsApp",
    finalCtaTitle: "Fale com a gente pelo WhatsApp",
    tagline: "Serviços, endereço e contato em um só lugar.",
    primary: "#6d28d9",
    accent: "#06b6d4",
  },
};

const normalize = (value: string) =>
  value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

export function sectorFamily(sector: string): SectorFamily {
  const wanted = normalize(sector);
  const found = (Object.keys(FAMILIES) as SectorFamily[]).find(
    (family) => family !== "default" && FAMILIES[family].keywords.some((keyword) => wanted.includes(keyword)),
  );
  return found ?? "default";
}

/**
 * The brief's visual direction is free text. A few words in it are enough to
 * pick a palette family; anything else keeps the sector's own colours.
 */
export function paletteFor(sector: string, visualDirection: string): { primary: string; accent: string } {
  const family = FAMILIES[sectorFamily(sector)];
  const direction = normalize(visualDirection);
  if (/quente|artesanal|terracota|ambar|rustic/.test(direction)) return { primary: "#c2410c", accent: "#f59e0b" };
  if (/clinic|sereno|frio|azul|verde-agua|calm/.test(direction)) return { primary: "#0369a1", accent: "#5eead4" };
  if (/claro|limpo|leve|minimal|suave/.test(direction)) return { primary: "#2563eb", accent: "#93c5fd" };
  if (/sofistic|premium|eleg|preto|dourad/.test(direction)) return { primary: "#1f2937", accent: "#d4af37" };
  return { primary: family.primary, accent: family.accent };
}

const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : cut.length).trim()}…`;
};

const sentence = (value: string) => {
  const text = value.trim();
  if (!text) return "";
  return /[.!?…]$/.test(text) ? text : `${text}.`;
};

const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase("pt-BR") + value.slice(1);

function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const split = rest.length === 9 ? [rest.slice(0, 5), rest.slice(5)] : [rest.slice(0, 4), rest.slice(4)];
    return `(${ddd}) ${split[0]}-${split[1]}`;
  }
  return e164;
}

export type SiteChannels = {
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  socialLinks: string[];
};

export function channelsFromBrief(brief: SiteBriefV2, lead?: Partial<DemoLeadInput>): SiteChannels {
  const contact = brief.publicContact;
  const address = contact.address?.value ?? null;
  const street = address
    ? [address.street, address.number].filter(Boolean).join(", ") + (address.complement ? ` - ${address.complement}` : "")
    : null;
  return {
    whatsapp: contact.whatsapp && isValidPhoneE164(contact.whatsapp.value) ? contact.whatsapp.value : null,
    phone: contact.phone && isValidPhoneE164(contact.phone.value) ? contact.phone.value : null,
    email: contact.email?.value ?? null,
    address: street,
    neighborhood: address?.neighborhood ?? null,
    city: address?.city ?? brief.city?.value ?? lead?.city ?? null,
    state: address?.state ?? (address ? null : (lead?.state ?? null)),
    socialLinks: contact.socialLinks.map((link) => link.value.url),
  };
}

/** The lead shape the demo snapshot expects, filled from the brief first. */
export function briefToDemoLead(brief: SiteBriefV2, lead?: Partial<DemoLeadInput>): DemoLeadInput {
  const channels = channelsFromBrief(brief, lead);
  const coordinates = brief.publicContact.coordinates?.value ?? null;
  const address = brief.publicContact.address?.value ?? null;
  return {
    name: brief.businessName.value,
    category: brief.sector.value,
    address: channels.address,
    neighborhood: channels.neighborhood,
    city: channels.city,
    state: channels.state,
    postalCode: address?.postalCode ?? null,
    phoneE164: channels.phone ?? channels.whatsapp,
    socialLinks: channels.socialLinks,
    website: null,
    latitude: coordinates?.latitude ?? lead?.latitude ?? null,
    longitude: coordinates?.longitude ?? lead?.longitude ?? null,
  };
}

/** Which of the labels the public page understands fits this brief. */
export function ctaLabelFor(brief: SiteBriefV2, channels: SiteChannels): string {
  const family = FAMILIES[sectorFamily(brief.sector.value)];
  const objective = normalize(brief.objective.value);
  if (channels.whatsapp) {
    if (/orcament/.test(objective)) return "Pedir orçamento";
    if (/agend|consulta|horario/.test(objective)) return "Agendar pelo WhatsApp";
    if (/pedido|pedir|delivery|entrega/.test(objective)) return "Pedir no WhatsApp";
    if (/reserv/.test(objective)) return "Reservar pelo WhatsApp";
    return family.ctaWhatsApp;
  }
  if (channels.phone) return "Ligar agora";
  return "Ver contato";
}

export function buildSiteContentFromBrief(params: {
  brief: SiteBriefV2;
  lead?: Partial<DemoLeadInput>;
}): DemoLandingContent {
  const { brief } = params;
  const name = clip(brief.businessName.value, 92);
  const sector = clip(brief.sector.value, 110);
  const sectorLower = lowerFirst(sector);
  const familyKey = sectorFamily(sector);
  const family = FAMILIES[familyKey];
  const channels = channelsFromBrief(brief, params.lead);
  const palette = paletteFor(sector, brief.visualDirection.value);
  const where = channels.city ? ` em ${channels.city}` : "";
  const phoneDisplay = channels.whatsapp ?? channels.phone;

  // --- narrative --------------------------------------------------------
  const positioning = sentence(brief.positioning.value);
  const audience = brief.audience.value.trim();
  const audienceSentence = audience
    ? sentence(/^(para|atende|pensad|feito)/i.test(audience) ? audience : `Pensado para ${lowerFirst(audience)}`)
    : "";
  const subheadline = clip(positioning || family.tagline, 320);
  const about = clip(
    [`${name} é ${sectorLower}${where}.`, positioning, audienceSentence].filter(Boolean).join(" "),
    1_200,
  );

  // --- differentiators (confirmed) or plain facts -----------------------
  const differentiators = brief.differentiators.map((fact) => clip(fact.value, 180)).filter(Boolean);
  const facts = [
    `${sector}${where}`,
    channels.whatsapp ? "Atendimento pelo WhatsApp" : null,
    channels.address ? `Endereço em ${channels.neighborhood ?? channels.city ?? "local informado"}` : null,
    channels.email ? "Contato por e-mail" : null,
  ].filter((value): value is string => Boolean(value));
  const benefits = (differentiators.length ? differentiators : facts).slice(0, 8);

  // --- services (confirmed) ----------------------------------------------
  const orderedServices = [...brief.services].sort((a, b) => Number(b.featured) - Number(a.featured));
  const services = orderedServices
    .map((service) => {
      const summary = service.summary.value.trim();
      return clip(summary ? `${service.name.value} — ${summary}` : service.name.value, 180);
    })
    .slice(0, 12);
  const servicesIntro = clip(
    channels.whatsapp
      ? `Veja o que ${name} oferece. Para ${family.action}, é só chamar no WhatsApp.`
      : phoneDisplay
        ? `Veja o que ${name} oferece. Para ${family.action}, ligue para ${formatPhone(phoneDisplay)}.`
        : `Veja o que ${name} oferece e entre em contato para ${family.action}.`,
    600,
  );

  // --- process -------------------------------------------------------------
  const contactStep = channels.whatsapp
    ? `Chame no WhatsApp ${formatPhone(channels.whatsapp)} e diga o que precisa.`
    : channels.phone
      ? `Ligue para ${formatPhone(channels.phone)} e diga o que precisa.`
      : channels.address
        ? `Venha até ${channels.address} e fale com a equipe.`
        : "Entre em contato pelos canais desta página e diga o que precisa.";
  const processSteps = [
    services.length
      ? `Escolha em ${lowerFirst(family.servicesTitle)} o que você quer.`
      : `Veja o que ${name} oferece nesta página.`,
    contactStep,
    family.outcome,
  ].map((step) => clip(step, 180));

  // --- FAQ from facts ------------------------------------------------------
  const faqs: { question: string; answer: string }[] = [];
  if (channels.address) {
    faqs.push({
      question: `Onde fica ${name}?`,
      answer: clip(`${name} fica em ${[channels.address, channels.neighborhood, channels.city, channels.state].filter(Boolean).join(", ")}.`, 600),
    });
  }
  if (channels.whatsapp || channels.phone || channels.email) {
    const ways = [
      channels.whatsapp ? `pelo WhatsApp ${formatPhone(channels.whatsapp)}` : null,
      channels.phone && channels.phone !== channels.whatsapp ? `pelo telefone ${formatPhone(channels.phone)}` : null,
      channels.email ? `pelo e-mail ${channels.email}` : null,
    ].filter(Boolean);
    faqs.push({
      question: `Como falar com ${name}?`,
      answer: clip(`Você pode falar com ${name} ${ways.join(", ")}.`, 600),
    });
  }
  if (orderedServices.length) {
    faqs.push({
      question: `O que ${name} oferece?`,
      answer: clip(`${orderedServices.map((service) => service.name.value).join(", ")}. Os detalhes de cada item estão na seção ${family.servicesTitle}.`, 600),
    });
  }
  if (channels.whatsapp) {
    faqs.push({
      question: `Dá para ${family.action} pelo WhatsApp?`,
      answer: clip(`Sim. Chame no WhatsApp ${formatPhone(channels.whatsapp)} e a equipe de ${name} continua o atendimento por lá.`, 600),
    });
  }
  faqs.push({
    question: "Esta página já é a versão definitiva?",
    answer: `Esta é uma prévia preparada para ${name}, com informações confirmadas antes da publicação. A versão definitiva entra no ar após a aprovação do estabelecimento.`,
  });

  // --- contact -------------------------------------------------------------
  const contactText = clip(
    [
      channels.whatsapp ? `WhatsApp ${formatPhone(channels.whatsapp)}.` : null,
      channels.phone && channels.phone !== channels.whatsapp ? `Telefone ${formatPhone(channels.phone)}.` : null,
      channels.email ? `E-mail ${channels.email}.` : null,
      channels.address ? `Endereço: ${[channels.address, channels.neighborhood, channels.city].filter(Boolean).join(", ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ") || `Fale com ${name} pelos canais desta página.`,
    600,
  );

  const finalCtaText = clip(
    channels.whatsapp
      ? `Chame ${name} no WhatsApp para ${family.action}. O atendimento continua por lá, sem cadastro e sem espera.`
      : `Entre em contato com ${name} pelos canais desta página para ${family.action}.`,
    600,
  );

  return demoLandingContentSchema.parse({
    headline: name,
    subheadline,
    about,
    aboutTitle: `Sobre ${name}`,
    benefits,
    factsTitle: differentiators.length ? "Por que escolher" : "Informações essenciais",
    services,
    servicesTitle: family.servicesTitle,
    servicesIntro,
    processTitle: family.processTitle,
    processIntro: clip(`Três passos simples para ${family.action} com ${name}.`, 600),
    processSteps,
    faqTitle: "Dúvidas frequentes",
    faqs: faqs.slice(0, 6),
    finalCtaTitle: clip(channels.whatsapp ? family.finalCtaTitle : `Fale com ${name}`, 120),
    finalCtaText,
    heroImageUrl: "",
    galleryTitle: `Conheça ${name}`,
    galleryIntro: clip(`Um pouco de ${name}, ${sectorLower}${where}. As fotos definitivas do estabelecimento entram nesta seção na versão final.`, 600),
    galleryImages: [],
    contactTitle: `Fale com ${name}`,
    contactText,
    businessSnapshot: createDemoBusinessSnapshot(briefToDemoLead(brief, params.lead)),
    whatsappE164: channels.whatsapp,
    ctaLabel: ctaLabelFor(brief, channels),
    primaryColor: palette.primary,
    accentColor: palette.accent,
  });
}
