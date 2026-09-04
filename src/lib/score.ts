export type ScoreInput = {
  website?: string | null;
  websiteStatus?: string;
  socialLinks?: string[];
  category?: string | null;
  phoneE164?: string | null;
  distanceKm?: number | null;
  isActiveHint?: boolean;
  reviewsCount?: number | null;
  reviewsRecent?: boolean;
  dataFreshDays?: number | null;
  looksLikeFranchise?: boolean;
  hasModernSiteHint?: boolean;
  maxRadiusKm?: number;
  sourceConfidenceBoost?: number;
};

export type ScoreBreakdown = {
  digitalGap: number;
  commercialPotential: number;
  serviceFit: number;
  contactability: number;
  proximity: number;
  penalties: number;
};

export type ScoreOutput = {
  opportunityScore: number;
  confidenceScore: number;
  reasons: string[];
  breakdown: ScoreBreakdown;
};

const SERVICE_FIT_KEYWORDS = [
  "restaurante",
  "lanchonete",
  "cafeteria",
  "padaria",
  "barbearia",
  "salao",
  "estetica",
  "academia",
  "estudio",
  "pet",
  "veterinar",
  "oficina",
  "automot",
  "escola",
  "curso",
  "roupa",
  "movel",
  "eletronic",
  "fotograf",
  "evento",
  "imobili",
  "contabil",
  "advoc",
  "clinica",
  "consultorio",
  "servico",
  "hotel",
  "pousada",
  "turismo",
  "catalogo",
  "reserva",
  "cardapio",
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeText(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function fitsNoxServices(category?: string | null): boolean {
  const text = normalizeText(category);
  return SERVICE_FIT_KEYWORDS.some((k) => text.includes(k));
}

/**
 * Deterministic opportunity score 0–100 with explainable reasons.
 * Never invents "não possui site" — uses "site não informado" / status from audit.
 */
export function scoreOpportunity(
  input: ScoreInput,
  penalties = { franchise: 15, modernSite: 20, stale: 10 },
): ScoreOutput {
  const reasons: string[] = [];
  const breakdown: ScoreBreakdown = {
    digitalGap: 0,
    commercialPotential: 0,
    serviceFit: 0,
    contactability: 0,
    proximity: 0,
    penalties: 0,
  };

  const hasWebsite = Boolean(input.website?.trim());
  const socialOnly =
    input.websiteStatus === "social_only" ||
    (!hasWebsite && (input.socialLinks?.length ?? 0) > 0);

  if (!hasWebsite && !socialOnly) {
    breakdown.digitalGap += 35;
    reasons.push("Site não informado");
  } else if (socialOnly) {
    breakdown.digitalGap += 20;
    reasons.push("Apenas rede social");
  }

  if (input.websiteStatus === "unavailable") {
    breakdown.digitalGap += 15;
    reasons.push("Site indisponível no teste");
  }

  breakdown.digitalGap = clamp(breakdown.digitalGap, 0, 50);

  if (input.isActiveHint !== false) {
    breakdown.commercialPotential += 10;
    reasons.push("Negócio ativo");
  }
  if ((input.reviewsCount ?? 0) > 0) {
    breakdown.commercialPotential += input.reviewsRecent ? 7 : 4;
  }
  if ((input.dataFreshDays ?? 30) <= 90) {
    breakdown.commercialPotential += 3;
  }
  breakdown.commercialPotential = clamp(breakdown.commercialPotential, 0, 20);

  if (fitsNoxServices(input.category)) {
    breakdown.serviceFit = 15;
    reasons.push("Adequado aos serviços NOX OS");
  } else if (input.category) {
    breakdown.serviceFit = 8;
  }

  if (input.phoneE164) {
    breakdown.contactability += 8;
    reasons.push("Telefone comercial");
  }
  if ((input.dataFreshDays ?? 999) <= 180) {
    breakdown.contactability += 2;
  }
  breakdown.contactability = clamp(breakdown.contactability, 0, 10);

  const maxR = input.maxRadiusKm ?? 80;
  if (input.distanceKm != null && Number.isFinite(input.distanceKm)) {
    breakdown.proximity = clamp(
      Math.round(5 * (1 - input.distanceKm / maxR) * 10) / 10,
      0,
      5,
    );
    if (input.distanceKm <= 10) reasons.push("Próximo de você");
  }

  let penalty = 0;
  if (input.looksLikeFranchise) {
    penalty += penalties.franchise;
    reasons.push("Possível franquia");
  }
  if (input.hasModernSiteHint && hasWebsite) {
    penalty += penalties.modernSite;
  }
  if ((input.dataFreshDays ?? 0) > 365) {
    penalty += penalties.stale;
    reasons.push("Dados incompletos");
  }
  if (!hasWebsite && !input.phoneE164) {
    reasons.push("Dados incompletos");
  }
  breakdown.penalties = penalty;

  const raw =
    breakdown.digitalGap +
    breakdown.commercialPotential +
    breakdown.serviceFit +
    breakdown.contactability +
    breakdown.proximity -
    penalty;

  const opportunityScore = clamp(Math.round(raw), 0, 100);
  const confidenceScore = computeConfidence(input);

  return {
    opportunityScore,
    confidenceScore,
    reasons: [...new Set(reasons)],
    breakdown,
  };
}

function computeConfidence(input: ScoreInput): number {
  let confidence = 35;
  if (input.phoneE164) confidence += 20;
  if (input.website) confidence += 10;
  if ((input.socialLinks?.length ?? 0) > 0) confidence += 5;
  if (input.distanceKm != null) confidence += 10;
  if ((input.dataFreshDays ?? 999) <= 90) confidence += 15;
  if (input.category) confidence += 5;
  confidence += input.sourceConfidenceBoost ?? 0;
  if (!input.phoneE164 && !input.website) confidence -= 10;
  return clamp(Math.round(confidence), 0, 100);
}
