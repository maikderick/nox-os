export type WizardPreset = {
  label: string;
  text: string;
};

export const OBJECTIVE_PRESETS: WizardPreset[] = [
  { label: "Receber pedidos pelo WhatsApp", text: "Receber pedidos e dúvidas pelo WhatsApp a partir do site." },
  { label: "Agendar atendimentos", text: "Facilitar o agendamento de atendimentos pelo WhatsApp." },
  { label: "Gerar orçamentos", text: "Receber pedidos de orçamento já com as informações necessárias." },
  { label: "Apresentar serviços e localização", text: "Apresentar os serviços e como encontrar o negócio." },
];

export const TONE_PRESETS: WizardPreset[] = [
  { label: "Profissional e sóbrio", text: "Atendimento profissional e direto, com foco em confiança e clareza nas informações." },
  { label: "Acolhedor e próximo", text: "Atendimento próximo e acolhedor, com linguagem simples e foco no relacionamento com o cliente." },
  { label: "Direto e objetivo", text: "Comunicação direta e objetiva: o cliente encontra o que precisa e entra em contato em poucos toques." },
  { label: "Sofisticado", text: "Apresentação cuidadosa e elegante, com foco na qualidade do serviço e na experiência do cliente." },
];

export const VISUAL_PRESETS: WizardPreset[] = [
  { label: "Escuro e marcante", text: "Fundo escuro, contraste alto, uma cor de destaque forte e fotos grandes." },
  { label: "Claro e limpo", text: "Fundo claro, bastante espaço em branco, tipografia leve e cores suaves." },
  { label: "Quente e artesanal", text: "Tons quentes como terracota e âmbar, texturas discretas e fotos do produto em destaque." },
  { label: "Clínico e sereno", text: "Tons frios e claros como azul e verde-água, layout organizado, sensação de calma e confiança." },
];
