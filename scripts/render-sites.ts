/* Renders one site per category to static HTML, for a visual check.
 *
 * Run from the repo root: `npx tsx scripts/render-sites.ts <outDir>`, then
 * screenshot the files with `npx playwright screenshot --viewport-size=…`.
 *
 * A dev tool, not part of the app. It exists because the anti-slop linter can
 * prove what is *absent* from the markup and nothing at all about whether the
 * page looks like a designer made it — and the hero is the one block where
 * that is the whole question. Committed so the next person can re-shoot the
 * fourteen without rebuilding the fixture.
 *
 * `next/font` does not run here, so the real Google faces come in by `<link>`
 * and the `--font-*` variables the direction points at are declared below by
 * hand. The handful of Tailwind utilities the renderer uses are shimmed for
 * the same reason: no build step runs, and without them the body sections
 * would render full-bleed and misrepresent the design. The hero itself needs
 * neither — it ships its own stylesheet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectSite } from "@/components/sites/project-site";
import { siteBriefSchema, type SiteBrief } from "@/lib/site-factory/brief-schema";

const OUT = process.argv[2];
if (!OUT) throw new Error("uso: tsx scripts/render-sites.ts <outDir>");
mkdirSync(OUT, { recursive: true });

const CONFIRMED = "2026-09-04T12:00:00.000Z";
const fact = (value: string) => ({ value, source: "OPERADOR" as const, confirmedAt: CONFIRMED });
const clientFact = (value: string) => ({ value, source: "CLIENTE" as const, confirmedAt: CONFIRMED });

type Service = { name: string; summary: string; body: string; price?: string };

type Case = {
  slug: string;
  seed: string;
  name: string;
  sector: string;
  positioning: string;
  about: string;
  differentiators: [string, string];
  services: [Service, Service, Service];
};

const CASES: Case[] = [
  {
    slug: "food",
    seed: "demo-food",
    name: "Forno da Esquina",
    sector: "Pizzaria",
    positioning: "Massa de fermentação lenta, forno a lenha e entrega no bairro até as onze.",
    about: "A Forno da Esquina fica na Aldeota e atende no salão, na retirada e na entrega.",
    differentiators: ["Massa fermentada por dois dias", "Entrega própria, sem aplicativo"],
    services: [
      { name: "Pizza no forno a lenha", summary: "Doze sabores fixos e o do dia, em massa fina.", body: "Servida inteira ou meio a meio, sem taxa pela combinação.", price: "R$ 58" },
      { name: "Calzone", summary: "O mesmo recheio da pizza, fechado e assado na hora.", body: "Sai em vinte minutos no salão.", price: "R$ 46" },
      { name: "Rodízio de terça", summary: "Rodízio às terças, à noite, no salão.", body: "Reserva por telefone na véspera.", price: "R$ 79" },
    ],
  },
  {
    slug: "beauty",
    seed: "demo-beauty",
    name: "Barbearia Aurora",
    sector: "Barbearia",
    positioning: "Corte com hora marcada, um cliente de cada vez, no centro de Fortaleza.",
    about: "A Aurora fica na rua Barão do Rio Branco, com três cadeiras e agenda fechada.",
    differentiators: ["Atendimento um de cada vez", "Agenda fechada, sem fila de espera"],
    services: [
      { name: "Corte", summary: "Tesoura ou máquina, com acabamento na navalha.", body: "Quarenta minutos de cadeira, com lavagem.", price: "R$ 55" },
      { name: "Barba", summary: "Toalha quente, navalha e finalização com óleo.", body: "Meia hora de cadeira, com hidratação da pele.", price: "R$ 45" },
      { name: "Corte e barba", summary: "Os dois serviços na mesma sessão.", body: "Uma hora e quinze de cadeira.", price: "R$ 90" },
    ],
  },
  {
    slug: "fitness",
    seed: "demo-fitness",
    name: "Box Norte",
    sector: "Academia",
    positioning: "Turmas de no máximo doze pessoas, com professor na sala o tempo todo.",
    about: "O Box Norte funciona no Papicu, com aulas de hora em hora, da manhã à noite.",
    differentiators: ["Turmas de até doze alunos", "Ficha de treino revista todo mês"],
    services: [
      { name: "Treino funcional", summary: "Sessões de cinquenta minutos, seis por dia.", body: "Sem carência: o plano é mensal e a saída é avisada na semana anterior.", price: "R$ 189/mês" },
      { name: "Musculação", summary: "Sala livre da manhã à noite, com ficha revista todo mês.", body: "Inclui acompanhamento do professor na sala.", price: "R$ 149/mês" },
      { name: "Personal", summary: "Uma hora individual, com plano escrito.", body: "Agendada direto com o professor.", price: "R$ 120" },
    ],
  },
  {
    slug: "pet",
    seed: "demo-pet",
    name: "Patas e Companhia",
    sector: "Pet shop",
    positioning: "Banho, tosa e consulta no mesmo lugar, com sala de espera separada por porte.",
    about: "A Patas e Companhia atende cães e gatos no Bairro de Fátima.",
    differentiators: ["Sala de espera separada por porte", "Retorno de consulta sem nova cobrança"],
    services: [
      { name: "Banho e tosa", summary: "Banho com secagem em ambiente climatizado.", body: "Tosa higiênica ou na tesoura, combinada antes.", price: "a partir de R$ 70" },
      { name: "Consulta veterinária", summary: "Clínica geral, com hora marcada.", body: "Retorno em duas semanas sem nova cobrança.", price: "R$ 160" },
      { name: "Vacinação", summary: "Aplicação com carteirinha atualizada na hora.", body: "Vacinas conferidas na chegada.", price: "sob consulta" },
    ],
  },
  {
    slug: "auto",
    seed: "demo-auto",
    name: "Oficina Meridiano",
    sector: "Oficina mecânica",
    positioning: "Orçamento escrito antes de abrir o carro, e a peça velha devolvida ao dono.",
    about: "A Meridiano trabalha com mecânica geral e injeção eletrônica na Messejana.",
    differentiators: ["Orçamento por escrito antes de começar", "Peça substituída devolvida ao cliente"],
    services: [
      { name: "Revisão completa", summary: "Trinta e dois itens conferidos, com laudo impresso.", body: "Inclui teste de rodagem antes da entrega.", price: "R$ 320" },
      { name: "Injeção eletrônica", summary: "Diagnóstico com scanner e leitura de falhas.", body: "O laudo sai antes de qualquer troca.", price: "R$ 180" },
      { name: "Freios", summary: "Pastilhas, discos e sangria do sistema.", body: "Peça e mão de obra orçadas em separado.", price: "sob consulta" },
    ],
  },
  {
    slug: "education",
    seed: "demo-education",
    name: "Escola Horizonte",
    sector: "Escola de idiomas",
    positioning: "Turmas de seis alunos, com a mesma professora do começo ao fim do nível.",
    about: "A Horizonte ensina inglês e espanhol na Aldeota, em quatro níveis por idioma.",
    differentiators: ["Turmas de até seis alunos", "A mesma professora do início ao fim do nível"],
    services: [
      { name: "Inglês regular", summary: "Duas aulas por semana, de hora e meia.", body: "Material incluído na mensalidade.", price: "R$ 380/mês" },
      { name: "Espanhol regular", summary: "Duas aulas por semana, de hora e meia.", body: "Turmas de manhã e à noite.", price: "R$ 360/mês" },
      { name: "Aula particular", summary: "Uma hora, presencial ou on-line.", body: "Plano combinado na primeira aula.", price: "R$ 130" },
    ],
  },
  {
    slug: "retail",
    seed: "demo-retail",
    name: "Loja Marista",
    sector: "Loja de roupas",
    positioning: "Peças de algodão e linho, em numeração ampla, com ajuste feito na loja.",
    about: "A Marista fica no Meireles e trabalha com produção brasileira em pequena escala.",
    differentiators: ["Ajuste de barra feito na loja", "Numeração ampla em toda a coleção"],
    services: [
      { name: "Alfaiataria", summary: "Calças e blazers em linho e algodão.", body: "Prova na loja, com ajuste em poucos dias.", price: "a partir de R$ 390" },
      { name: "Camisaria", summary: "Camisas de algodão, manga curta e longa.", body: "Reposição de tamanhos toda quinta.", price: "a partir de R$ 210" },
      { name: "Ajuste", summary: "Barra, cintura e manga, para peças da loja.", body: "Feito pela costureira da casa.", price: "R$ 40" },
    ],
  },
  {
    slug: "events",
    seed: "demo-events",
    name: "Estúdio Clarice",
    sector: "Fotógrafo",
    positioning: "Fotografia de casamento e retrato, com entrega das imagens em um mês.",
    about: "O Estúdio Clarice fotografa casamentos e retratos em Fortaleza e no interior.",
    differentiators: ["Entrega em até um mês", "Todas as fotos tratadas, sem seleção por pacote"],
    services: [
      { name: "Casamento", summary: "Cobertura da preparação à festa, com dois fotógrafos.", body: "Entrega em galeria on-line e álbum impresso.", price: "sob consulta" },
      { name: "Retrato", summary: "Sessão de uma hora, em estúdio ou externa.", body: "Trinta imagens tratadas.", price: "R$ 780" },
      { name: "Ensaio de família", summary: "Sessão de uma hora e meia, ao ar livre.", body: "Quarenta imagens tratadas.", price: "R$ 950" },
    ],
  },
  {
    slug: "realestate",
    seed: "demo-realestate",
    name: "Imobiliária Meridional",
    sector: "Imobiliária",
    positioning: "Somente imóveis visitados pela equipe, com planta e medidas conferidas.",
    about: "A Meridional trabalha com locação e venda residencial em Fortaleza.",
    differentiators: ["Todo imóvel visitado pela equipe", "Planta e medidas conferidas no local"],
    services: [
      { name: "Locação residencial", summary: "Cadastro, vistoria e contrato na mesma semana.", body: "Vistoria fotografada, entregue às duas partes.", price: "sob consulta" },
      { name: "Venda", summary: "Estudo de valor com base em imóveis comparáveis do bairro.", body: "Laudo entregue por escrito.", price: "sob consulta" },
      { name: "Administração de aluguel", summary: "Cobrança, repasse e manutenção acompanhada.", body: "Prestação de contas mensal.", price: "sob consulta" },
    ],
  },
  {
    slug: "professional",
    seed: "demo-professional",
    name: "Martins e Associados",
    sector: "Advocacia",
    positioning: "Direito de família e sucessões, com honorários combinados na primeira reunião.",
    about: "O escritório atua em Fortaleza com quatro advogados e uma equipe de apoio.",
    differentiators: ["Honorários fechados na primeira reunião", "Um advogado responsável por processo"],
    services: [
      { name: "Direito de família", summary: "Divórcio, guarda e pensão, judicial ou consensual.", body: "A primeira reunião dura uma hora e não é cobrada.", price: "sob consulta" },
      { name: "Sucessões", summary: "Inventário e partilha, em cartório ou em juízo.", body: "Prazo estimado por escrito na proposta.", price: "sob consulta" },
      { name: "Consultoria", summary: "Parecer escrito sobre uma questão pontual.", body: "Entregue em até duas semanas.", price: "R$ 1.200" },
    ],
  },
  {
    slug: "health",
    seed: "demo-health",
    name: "Consultório Vila Clara",
    sector: "Consultório odontológico",
    positioning: "Uma consulta por vez, com plano de tratamento entregue por escrito.",
    about: "O consultório atende clínica geral e periodontia no Dionísio Torres.",
    differentiators: ["Uma consulta por vez", "Plano de tratamento entregue por escrito"],
    services: [
      { name: "Consulta inicial", summary: "Exame clínico, radiografia e plano de tratamento.", body: "O plano sai impresso, com o valor de cada etapa.", price: "R$ 180" },
      { name: "Limpeza", summary: "Profilaxia e aplicação de flúor.", body: "Uma sessão de quarenta minutos.", price: "R$ 220" },
      { name: "Restauração", summary: "Resina composta, por dente.", body: "Feita na mesma sessão da consulta inicial, quando possível.", price: "R$ 260" },
    ],
  },
  {
    slug: "services",
    seed: "demo-services",
    name: "Chaveiro Andrade",
    sector: "Chaveiro",
    positioning: "Atendimento no local em menos de uma hora, na cidade toda, todo dia.",
    about: "O Andrade trabalha com chaves, fechaduras e travas eletrônicas em Fortaleza.",
    differentiators: ["Atendimento no local em menos de uma hora", "Valor fechado antes do deslocamento"],
    services: [
      { name: "Abertura de porta", summary: "Sem quebrar a fechadura, mediante documento do imóvel.", body: "O documento é conferido antes de começar.", price: "a partir de R$ 120" },
      { name: "Troca de fechadura", summary: "Fechaduras comuns, tetra e digitais.", body: "Peça e mão de obra orçadas em separado.", price: "sob consulta" },
      { name: "Cópia de chave", summary: "Chaves simples, tetra e codificadas.", body: "Feita na hora, no balcão.", price: "a partir de R$ 15" },
    ],
  },
  {
    slug: "tourism",
    seed: "demo-tourism",
    name: "Pousada da Enseada",
    sector: "Pousada",
    positioning: "Nove quartos de frente para o mar, com café da manhã servido até as dez.",
    about: "A pousada fica na Praia da Enseada, em Icapuí, com nove quartos e uma varanda comum.",
    differentiators: ["Nove quartos, todos de frente para o mar", "Café da manhã servido até as dez"],
    services: [
      { name: "Quarto duplo", summary: "Cama de casal, varanda e ar-condicionado.", body: "Café da manhã incluso na diária.", price: "R$ 390 a diária" },
      { name: "Quarto família", summary: "Cama de casal e duas de solteiro.", body: "Café da manhã incluso, para até quatro pessoas.", price: "R$ 560 a diária" },
      { name: "Passeio de barco", summary: "Saída pela manhã, com retorno ao meio-dia.", body: "Combinado na recepção, na véspera.", price: "R$ 140 por pessoa" },
    ],
  },
  {
    slug: "catalog",
    seed: "demo-catalog",
    name: "Catálogo Serra Azul",
    sector: "Catálogo",
    positioning: "Cento e vinte referências em estoque, com prazo de entrega item a item.",
    about: "A Serra Azul distribui utilidades domésticas para lojistas do interior do Ceará.",
    differentiators: ["Prazo de entrega informado item a item", "Pedido mínimo de uma caixa"],
    services: [
      { name: "Linha cozinha", summary: "Quarenta e duas referências, entrega em poucos dias.", body: "Caixa fechada com doze unidades.", price: "sob consulta" },
      { name: "Linha limpeza", summary: "Trinta e oito referências, entrega em poucos dias.", body: "Caixa fechada com vinte e quatro unidades.", price: "sob consulta" },
      { name: "Linha organização", summary: "Quarenta referências, entrega em uma semana.", body: "Caixa fechada com seis unidades.", price: "sob consulta" },
    ],
  },
];

function brief(entry: Case): SiteBrief {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact(entry.name),
    sector: fact(entry.sector),
    city: fact("Fortaleza"),
    // Internos: nunca publicados. Ficam aqui de propósito, para que a captura
    // prove que não vazam para a página.
    objective: fact("Apresentar o negócio e receber contato de quem procura o serviço na região."),
    audience: fact("Pessoas do bairro e arredores."),
    positioning: fact(entry.positioning),
    about: fact(entry.about),
    differentiators: entry.differentiators.map(fact),
    desiredSections: ["Início", "Sobre", "Serviços", "Horários", "Localização", "Contato"],
    visualDirection: fact("Sóbrio e legível."),
    notes: null,
    services: entry.services.map((service, index) => ({
      id: `servico-${index + 1}`,
      name: fact(service.name),
      summary: fact(service.summary),
      body: [fact(service.body)],
      price: service.price ? fact(service.price) : null,
      relatedIds: [],
      featured: index === 0,
    })),
    publicContact: {
      phone: clientFact("+5585999998888"),
      whatsapp: clientFact("+5585999998888"),
      email: clientFact(`contato@${entry.slug}.com.br`),
      address: {
        value: {
          street: "Rua das Flores", number: "120", complement: null,
          neighborhood: "Aldeota", city: "Fortaleza", state: "CE",
          postalCode: "60150-160", country: "Brasil",
        },
        source: "CLIENTE" as const,
        confirmedAt: CONFIRMED,
      },
      coordinates: null,
      openingHours: {
        value: [
          { dayOfWeek: "SEGUNDA", opens: "09:00", closes: "18:00" },
          { dayOfWeek: "TERCA", opens: "09:00", closes: "18:00" },
          { dayOfWeek: "QUARTA", opens: "09:00", closes: "18:00" },
          { dayOfWeek: "SABADO", opens: "09:00", closes: "13:00" },
        ],
        source: "CLIENTE" as const,
        confirmedAt: CONFIRMED,
      },
      socialLinks: [
        {
          value: { platform: "INSTAGRAM" as const, url: "https://instagram.com/exemplo", label: null },
          source: "CLIENTE" as const,
          confirmedAt: CONFIRMED,
        },
      ],
    },
    metaDescription: null,
  });
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700" +
  "&family=DM+Mono:wght@400;500" +
  "&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700" +
  "&family=Instrument+Serif" +
  "&family=Inter+Tight:wght@400;500;600;700" +
  "&family=Inter:wght@400;500;600;700" +
  "&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700" +
  "&family=Work+Sans:wght@400;500;600;700&display=swap";

const FONT_VARS =
  ":root{--font-fraunces:'Fraunces',Georgia,serif;" +
  "--font-source-serif:'Source Serif 4',Georgia,serif;" +
  "--font-instrument-serif:'Instrument Serif',Georgia,serif;" +
  "--font-archivo:'Archivo','Helvetica Neue',sans-serif;" +
  "--font-inter-tight:'Inter Tight','Helvetica Neue',sans-serif;" +
  "--font-inter:'Inter','Helvetica Neue',sans-serif;" +
  "--font-work-sans:'Work Sans','Helvetica Neue',sans-serif;" +
  "--font-dm-mono:'DM Mono',monospace}";

/** The slice of Tailwind's preflight and utilities the renderer actually uses. */
const TAILWIND_SHIM =
  "*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}" +
  "body{margin:0;-webkit-font-smoothing:antialiased}" +
  "h1,h2,h3{font-size:inherit;font-weight:inherit}" +
  "ul,ol{list-style:none}" +
  "a{color:inherit;text-decoration:inherit}" +
  "svg{display:block;vertical-align:middle}" +
  ".min-h-screen{min-height:100vh}.overflow-x-hidden{overflow-x:hidden}" +
  ".mx-auto{margin-inline:auto}.max-w-5xl{max-width:64rem}" +
  ".px-6{padding-inline:1.5rem}.py-5{padding-block:1.25rem}" +
  ".flex{display:flex}.inline-block{display:inline-block}" +
  ".items-baseline{align-items:baseline}.items-center{align-items:center}" +
  ".justify-between{justify-content:space-between}" +
  ".gap-3{gap:0.75rem}.gap-4{gap:1rem}.gap-6{gap:1.5rem}" +
  ".truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".break-all{word-break:break-all}";

for (const entry of CASES) {
  const html = renderToStaticMarkup(
    React.createElement(ProjectSite, { brief: brief(entry), seed: entry.seed }),
  );
  const doc =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${entry.name}</title>` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="${FONTS}">` +
    `<style>${TAILWIND_SHIM}${FONT_VARS}</style></head><body>${html}</body></html>`;
  writeFileSync(join(OUT, `${entry.slug}.html`), doc, "utf8");
  console.log(`${entry.slug}: ${html.length} bytes`);
}
