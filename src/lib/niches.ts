import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  Cake,
  Calculator,
  Camera,
  Car,
  Coffee,
  Dumbbell,
  Fan,
  Flower2,
  GraduationCap,
  Hammer,
  HeartHandshake,
  HeartPulse,
  Home,
  Hotel,
  PawPrint,
  Pizza,
  Salad,
  Scissors,
  ShoppingBag,
  Sofa,
  Sparkles,
  Stethoscope,
  Utensils,
  Wrench,
  SprayCan,
  PartyPopper,
  Droplets,
  Smile,
} from "lucide-react";

/**
 * The niches an operator can pick as the sector of a project.
 *
 * The label is what goes into the brief (the sector is free text there), the
 * keywords tie the niche to the categories the prospecting import produces,
 * so a chosen niche can narrow the lead list.
 */
export type Niche = {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  /** Short line used by the public site and by the wizard's card. */
  hint: string;
};

export const NICHES: Niche[] = [
  { id: "barbearia", label: "Barbearia", icon: Scissors, keywords: ["barbearia", "barbeiro", "salão"], hint: "Agenda, serviços e localização" },
  { id: "pizzaria", label: "Pizzaria", icon: Pizza, keywords: ["pizzaria", "pizza", "restaurante"], hint: "Cardápio e pedido pelo WhatsApp" },
  { id: "hamburgueria", label: "Hamburgueria", icon: Utensils, keywords: ["hamburgueria", "lanchonete", "lanche", "burger"], hint: "Cardápio, combos e delivery" },
  { id: "restaurante", label: "Restaurante", icon: Salad, keywords: ["restaurante", "comida", "self-service"], hint: "Cardápio, reservas e horários" },
  { id: "cafeteria", label: "Cafeteria", icon: Coffee, keywords: ["cafeteria", "café", "cafe"], hint: "Ambiente, cardápio e localização" },
  { id: "padaria", label: "Padaria e confeitaria", icon: Cake, keywords: ["padaria", "confeitaria", "doceria", "bolo"], hint: "Produtos, encomendas e horários" },
  { id: "odontologia", label: "Clínica odontológica", icon: Smile, keywords: ["odonto", "dentista", "dental"], hint: "Tratamentos e agendamento" },
  { id: "clinica", label: "Consultório e clínica", icon: Stethoscope, keywords: ["clínica", "clinica", "consultório", "médic", "medic"], hint: "Especialidades e convênios" },
  { id: "estetica", label: "Clínica de estética", icon: Sparkles, keywords: ["estética", "estetica", "beleza"], hint: "Procedimentos e agendamento" },
  { id: "salao", label: "Salão de beleza", icon: Flower2, keywords: ["salão", "salao", "cabeleireiro", "beleza"], hint: "Serviços, equipe e agenda" },
  { id: "fisioterapia", label: "Fisioterapia", icon: Activity, keywords: ["fisioterapia", "fisio", "pilates"], hint: "Atendimentos e planos" },
  { id: "academia", label: "Academia e personal", icon: Dumbbell, keywords: ["academia", "fitness", "crossfit", "personal", "estúdio"], hint: "Planos, modalidades e horários" },
  { id: "nutricao", label: "Nutrição", icon: HeartPulse, keywords: ["nutrição", "nutricao", "nutricionista"], hint: "Consultas e acompanhamento" },
  { id: "psicologia", label: "Psicologia", icon: HeartHandshake, keywords: ["psicologia", "psicólogo", "psicologo", "terapia"], hint: "Atendimento e agendamento" },
  { id: "petshop", label: "Pet shop", icon: PawPrint, keywords: ["pet", "petshop", "banho e tosa"], hint: "Serviços, produtos e delivery" },
  { id: "veterinaria", label: "Clínica veterinária", icon: PawPrint, keywords: ["veterinária", "veterinaria", "veterinário"], hint: "Atendimento e emergência" },
  { id: "mecanica", label: "Mecânica e auto center", icon: Wrench, keywords: ["oficina", "mecânica", "mecanica", "auto center", "automotivo"], hint: "Serviços e orçamento rápido" },
  { id: "lavarapido", label: "Lava-rápido e estética automotiva", icon: Car, keywords: ["lava", "estética automotiva", "lavagem"], hint: "Pacotes e agendamento" },
  { id: "advocacia", label: "Escritório de advocacia", icon: BriefcaseBusiness, keywords: ["advocacia", "advogado", "jurídico", "juridico"], hint: "Áreas de atuação e contato" },
  { id: "contabilidade", label: "Contabilidade", icon: Calculator, keywords: ["contabilidade", "contador", "contábil"], hint: "Serviços e abertura de empresa" },
  { id: "seguros", label: "Corretor de seguros", icon: BadgeDollarSign, keywords: ["seguro", "corretor", "corretora"], hint: "Produtos e cotação" },
  { id: "imobiliaria", label: "Imobiliária", icon: Home, keywords: ["imobiliária", "imobiliaria", "imóveis", "imoveis", "corretor de imóveis"], hint: "Imóveis, busca e contato" },
  { id: "construcao", label: "Construção e reforma", icon: Hammer, keywords: ["construção", "construcao", "reforma", "engenharia", "arquitetura"], hint: "Portfólio e orçamento" },
  { id: "moveis", label: "Móveis planejados", icon: Sofa, keywords: ["móveis", "moveis", "marcenaria", "planejados"], hint: "Projetos e orçamento" },
  { id: "arcondicionado", label: "Ar-condicionado e refrigeração", icon: Fan, keywords: ["ar-condicionado", "ar condicionado", "refrigeração", "refrigeracao", "climatização"], hint: "Instalação e manutenção" },
  { id: "assistencia", label: "Assistência técnica", icon: Wrench, keywords: ["assistência", "assistencia", "conserto", "reparo", "celular"], hint: "Serviços e orçamento" },
  { id: "limpeza", label: "Limpeza e conservação", icon: SprayCan, keywords: ["limpeza", "conservação", "diarista", "dedetização"], hint: "Serviços e orçamento" },
  { id: "buffet", label: "Buffet e eventos", icon: PartyPopper, keywords: ["buffet", "eventos", "festa", "cerimonial"], hint: "Pacotes, espaço e contato" },
  { id: "fotografia", label: "Fotografia", icon: Camera, keywords: ["fotografia", "fotógrafo", "fotografo", "estúdio"], hint: "Portfólio e pacotes" },
  { id: "escola", label: "Escola e cursos", icon: GraduationCap, keywords: ["escola", "curso", "ensino", "idiomas", "reforço"], hint: "Cursos, turmas e matrícula" },
  { id: "hotel", label: "Hotel e pousada", icon: Hotel, keywords: ["hotel", "pousada", "hospedagem", "hostel"], hint: "Quartos, fotos e reservas" },
  { id: "loja", label: "Loja e varejo", icon: ShoppingBag, keywords: ["loja", "roupas", "moda", "boutique", "eletrônicos", "varejo"], hint: "Catálogo e contato" },
  { id: "piscina", label: "Piscinas e tratamento de água", icon: Droplets, keywords: ["piscina", "água", "agua", "poço"], hint: "Serviços e manutenção" },
  { id: "servicos", label: "Outros serviços locais", icon: Building2, keywords: ["serviço", "servico", "prestador"], hint: "Apresentação, serviços e contato" },
];

const normalize = (value: string) =>
  value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

export function findNicheByLabel(label: string): Niche | null {
  const wanted = normalize(label.trim());
  if (!wanted) return null;
  return NICHES.find((niche) => normalize(niche.label) === wanted) ?? null;
}

export function searchNiches(query: string): Niche[] {
  const wanted = normalize(query.trim());
  if (!wanted) return NICHES;
  return NICHES.filter(
    (niche) =>
      normalize(niche.label).includes(wanted) ||
      niche.keywords.some((keyword) => normalize(keyword).includes(wanted)),
  );
}

/** Whether a lead category, as the import wrote it, belongs to a niche. */
export function categoryMatchesNiche(category: string, niche: Niche): boolean {
  const wanted = normalize(category);
  if (!wanted) return false;
  if (normalize(niche.label).includes(wanted) || wanted.includes(normalize(niche.label))) return true;
  return niche.keywords.some((keyword) => {
    const key = normalize(keyword);
    return wanted.includes(key) || key.includes(wanted);
  });
}
