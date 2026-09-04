/**
 * Shared defence against invented facts.
 *
 * The demo landing generator and the site brief both accept free text written by
 * a human or rewritten by a model, and both promise the same thing: nothing on a
 * page or in a brief that the lead record cannot back up. The rules live here so
 * the two paths can never drift apart.
 */

export function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type ClaimRule = {
  id: string;
  label: string;
  pattern: RegExp;
};

const CLAIM_RULES: ClaimRule[] = [
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

/** Every rule id, so a caller can allow one explicitly instead of by accident. */
export const CLAIM_RULE_IDS = CLAIM_RULES.map((rule) => rule.id);

export type TextEntry = {
  field: string;
  value: string;
};

export type ClaimRisk = {
  rule: string;
  label: string;
  field: string;
  sample: string;
};

/**
 * Reports every rule a piece of text trips. `allow` exists for fields where a
 * pattern is legitimate — a contact section may carry an address the operator
 * confirmed — and must be opted into per call, never globally.
 */
export function findClaimRisks(
  entries: TextEntry[],
  options: { allow?: readonly string[] } = {},
): ClaimRisk[] {
  const allowed = new Set(options.allow ?? []);
  const risks: ClaimRisk[] = [];

  for (const entry of entries) {
    const normalized = normalizeForMatching(entry.value);
    for (const rule of CLAIM_RULES) {
      if (allowed.has(rule.id)) continue;
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
