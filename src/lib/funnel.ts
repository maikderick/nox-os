export const FUNNEL_STAGES = [
  "novo",
  "revisar",
  "opt_in_pendente",
  "apto_whatsapp",
  "contatado",
  "respondeu",
  "reuniao",
  "proposta",
  "cliente",
  "nao_interessado",
  "nao_contatar",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  novo: "Novo",
  revisar: "Revisar",
  opt_in_pendente: "Opt-in pendente",
  apto_whatsapp: "Apto para WhatsApp",
  contatado: "Contatado",
  respondeu: "Respondeu",
  reuniao: "Reunião",
  proposta: "Proposta",
  cliente: "Cliente",
  nao_interessado: "Não interessado",
  nao_contatar: "Não contatar",
};

export const DEFAULT_RADII_KM = [5, 10, 20, 40, 80] as const;
