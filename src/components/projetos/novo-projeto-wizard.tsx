"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
  Trash2,
} from "lucide-react";

import type { BriefCapabilities } from "@/lib/site-factory/brief-schema";
import {
  addressHasContent,
  authoredFact,
  buildBriefV2,
  createServiceDraft,
  createSocialLinkDraft,
  editSocialLinkDraft,
  initialBriefDraft,
  guessSocialPlatform,
  isFactConfirmed,
  nowIso,
  pinServiceId,
  renameServiceDraft,
  setFactConfirmed,
  setServiceId,
  suggestedFact,
  typedFact,
  validateClaims,
  validateNarrative,
  validatePublicContact,
  validateServices,
  type AddressDraft,
  type BriefDraft,
  type BriefSocialPlatform,
  type ContactDraft,
  type DraftFact,
  type DraftIssue,
  type ServiceDraft,
  type SocialLinkDraft,
} from "@/lib/site-factory/brief-draft";
import { categoryMatchesNiche, findNicheByLabel, searchNiches, type Niche } from "@/lib/niches";
import { normalizePhoneE164 } from "@/lib/phone";
import { cn, opportunityBand } from "@/lib/utils";
import { hasOwnWebsite } from "@/lib/website";

type Lead = {
  id: string;
  name: string;
  category: string;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  address: string | null;
  postalCode: string | null;
  phoneE164: string | null;
  website?: string | null;
  socialLinks: string[];
  opportunityScore: number;
};

/** What the studio calls itself, for the approach script. Placeholders arrive as null. */
export type StudioIdentity = {
  brandName: string;
  sellerName: string | null;
  city: string | null;
};

const STEPS = ["Setor", "Leads", "Negócio", "Abordagem", "Briefing"];

/**
 * Which draft fields each step is responsible for.
 *
 * The validators are shared with the payload builder, so a step refuses to
 * advance for exactly the reasons the API would refuse the brief.
 */
const STEP_FIELDS: string[][] = [
  ["sector"],
  [],
  ["businessName", "city", "objective"],
  ["audience", "positioning", "visualDirection", "differentiators", "metaDescription"],
  ["desiredSections", "services", "publicContact", "notes"],
];

const SOCIAL_PLATFORM_LABELS: Record<BriefSocialPlatform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  X: "X",
};

const SOCIAL_PLATFORMS = Object.keys(SOCIAL_PLATFORM_LABELS) as BriefSocialPlatform[];

/**
 * Quick fills. Each one writes plain operator text into an existing field, so
 * nothing new reaches the payload — the operator still owns every sentence.
 */
const OBJECTIVE_PRESETS: { label: string; text: string }[] = [
  { label: "Receber pedidos pelo WhatsApp", text: "Receber pedidos e dúvidas pelo WhatsApp a partir do site." },
  { label: "Agendar atendimentos", text: "Facilitar o agendamento de atendimentos pelo WhatsApp." },
  { label: "Gerar orçamentos", text: "Receber pedidos de orçamento já com as informações necessárias." },
  { label: "Apresentar serviços e localização", text: "Apresentar os serviços, o endereço e os horários para quem busca na região." },
];

const TONE_PRESETS: { label: string; text: string }[] = [
  { label: "Profissional e sóbrio", text: "Atendimento profissional e direto, com foco em confiança e clareza nas informações." },
  { label: "Acolhedor e próximo", text: "Atendimento próximo e acolhedor, com linguagem simples e foco no relacionamento com o cliente." },
  { label: "Direto e objetivo", text: "Comunicação direta e objetiva: o cliente encontra o que precisa e entra em contato em poucos toques." },
  { label: "Sofisticado", text: "Apresentação cuidadosa e elegante, com foco na qualidade do serviço e na experiência do cliente." },
];

const VISUAL_PRESETS: { label: string; text: string }[] = [
  { label: "Escuro e marcante", text: "Fundo escuro, contraste alto, uma cor de destaque forte e fotos grandes." },
  { label: "Claro e limpo", text: "Fundo claro, bastante espaço em branco, tipografia leve e cores suaves." },
  { label: "Quente e artesanal", text: "Tons quentes como terracota e âmbar, texturas discretas e fotos do produto em destaque." },
  { label: "Clínico e sereno", text: "Tons frios e claros como azul e verde-água, layout organizado, sensação de calma e confiança." },
];

/** The draft keys that hold a single confirmable fact. */
type FactField = {
  [K in keyof BriefDraft]: BriefDraft[K] extends DraftFact ? K : never;
}[keyof BriefDraft];

function describeApiError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const flat = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const parts = [
      ...(flat.formErrors ?? []),
      ...Object.entries(flat.fieldErrors ?? {}).map(
        ([field, messages]) => `${field}: ${messages.join(", ")}`,
      ),
    ];
    if (parts.length > 0) return parts.join(" · ");
  }
  return "Revise o briefing: há campos inválidos ou afirmações sem confirmação.";
}

type ScriptBlock = { title: string; hint: string; text: string };

/**
 * The pre-sales script, in blocks. Only says what the panel knows: the lead
 * has no own website (that is why it is in the queue) and what the studio
 * offers. No prices, no promises.
 */
function buildApproachScript(params: {
  businessName: string;
  sector: string;
  city: string;
  studio: StudioIdentity;
  hasWebsite: boolean;
}): ScriptBlock[] {
  const business = params.businessName.trim() || "o seu negócio";
  const sector = params.sector.trim().toLocaleLowerCase("pt-BR") || "negócios locais";
  const where = params.city.trim() ? ` em ${params.city.trim()}` : "";
  const seller = params.studio.sellerName ?? "[seu nome]";
  const brand = params.studio.brandName;

  const diagnosis = params.hasWebsite
    ? `Procurei pela ${business} no Google e encontrei o site atual. Quem procura por ${sector}${where} decide em segundos, então vale conferir se a página abre bem no celular e leva ao WhatsApp em um toque.`
    : `Procurei pela ${business} no Google e não encontrei um site próprio, só o cadastro no mapa. Quem procura por ${sector}${where} e não acha uma página com serviços e contato acaba fechando com quem tem.`;

  return [
    {
      title: "Abertura",
      hint: "Curta. Só confirma que está falando com quem decide.",
      text: `Olá! Tudo bem? Falo com o responsável pela ${business}?`,
    },
    {
      title: "Apresentação",
      hint: "Quem você é, em uma frase.",
      text: `Meu nome é ${seller}, da ${brand}. Eu crio sites para ${sector}${where}: páginas feitas para o cliente achar e entrar em contato, não só um cartão de visitas online.`,
    },
    {
      title: "Diagnóstico",
      hint: "Mostre o que você olhou. Só afirme o que dá para verificar.",
      text: diagnosis,
    },
    {
      title: "Proposta de valor",
      hint: "O que ele ganha, em coisas concretas.",
      text: `Eu montaria para a ${business} uma página com:\n• Seus serviços explicados do jeito que o cliente entende\n• Botão de WhatsApp em todas as seções, para o contato ser em um toque\n• Estrutura pensada para aparecer nas buscas de ${sector}${where}\n\nFica pronta rápido e você aprova antes de qualquer coisa ir ao ar.`,
    },
    {
      title: "Fechamento",
      hint: "Peça uma ação pequena, não a venda inteira.",
      text: `Posso montar uma prévia da página da ${business} e te mandar ainda hoje? Se não fizer sentido, você me diz e não custa nada.`,
    },
  ];
}

export function NewProjectWizard({ studio }: { studio: StudioIdentity }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<Record<number, boolean>>({});
  const [leadId, setLeadId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [draft, setDraft] = useState<BriefDraft>(initialBriefDraft);
  const [outcome, setOutcome] = useState<BriefCapabilities | null>(null);
  const [createdPath, setCreatedPath] = useState("/projetos");
  const [nicheQuery, setNicheQuery] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadFilter, setLeadFilter] = useState<"all" | "high" | "phone">("all");
  const keySeed = useRef(0);

  const nextKey = () => `row-${(keySeed.current += 1)}`;

  useEffect(() => {
    let active = true;
    fetch("/api/leads?pageSize=100&sort=score_desc")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os leads.");
        return response.json() as Promise<{ items: Lead[] }>;
      })
      .then((payload) => {
        if (!active) return;
        setLeads(
          payload.items.map((lead) => ({
            ...lead,
            socialLinks: Array.isArray(lead.socialLinks) ? lead.socialLinks : [],
          })),
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Falha ao carregar leads.");
      })
      .finally(() => {
        if (active) setLoadingLeads(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedNiche: Niche | null = useMemo(
    () => findNicheByLabel(draft.sector.value),
    [draft.sector.value],
  );
  const visibleNiches = useMemo(() => searchNiches(nicheQuery), [nicheQuery]);

  /**
   * The sector narrows the list, it does not gate it.
   *
   * A niche matches through its keywords, free text through a loose match. A
   * sector that matches nothing falls back to every lead instead of to none.
   */
  const filteredLeads = useMemo(() => {
    const sector = draft.sector.value.trim().toLowerCase();
    let matching = leads;
    if (sector) {
      matching = leads.filter((lead) => {
        const category = lead.category.toLowerCase();
        if (selectedNiche && categoryMatchesNiche(lead.category, selectedNiche)) return true;
        return category.includes(sector) || sector.includes(category);
      });
      if (matching.length === 0) matching = leads;
    }
    const query = leadQuery.trim().toLowerCase();
    if (query) {
      matching = matching.filter((lead) =>
        [lead.name, lead.city, lead.neighborhood, lead.category, lead.address]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
      );
    }
    if (leadFilter === "high") matching = matching.filter((lead) => lead.opportunityScore >= 70);
    if (leadFilter === "phone") matching = matching.filter((lead) => Boolean(lead.phoneE164));
    return matching;
  }, [leads, draft.sector.value, selectedNiche, leadQuery, leadFilter]);

  const selectedLead = leads.find((lead) => lead.id === leadId) ?? null;

  const script = useMemo(
    () =>
      buildApproachScript({
        businessName: draft.businessName.value || selectedLead?.name || "",
        sector: draft.sector.value,
        city: draft.city.value || selectedLead?.city || "",
        studio,
        hasWebsite: hasOwnWebsite(selectedLead?.website),
      }),
    [draft.businessName.value, draft.sector.value, draft.city.value, selectedLead, studio],
  );

  const allIssues = useMemo(
    () => [
      ...validateNarrative(draft),
      ...validateServices(draft.services),
      ...validatePublicContact(draft.contact),
      ...validateClaims(draft),
    ],
    [draft],
  );

  const stepIssues = useMemo<DraftIssue[]>(() => {
    const own: DraftIssue[] = allIssues.filter((issue) =>
      STEP_FIELDS[step].some(
        (field) => issue.field === field || issue.field.startsWith(`${field}.`),
      ),
    );
    if (step === 1 && !selectedLead) {
      own.push({ field: "lead", message: "Escolha o negócio que origina o projeto." });
    }
    if (step === 2 && !projectName.trim()) {
      own.push({ field: "projectName", message: "Nome do projeto: informe como a operação chama este trabalho." });
    }
    return own;
  }, [allIssues, step, selectedLead, projectName]);

  const isInvalid = (field: string) =>
    attempted[step] === true &&
    stepIssues.some((issue) => issue.field === field || issue.field.startsWith(`${field}.`));

  const showIssues = attempted[step] === true && stepIssues.length > 0;
  const issuesId = `etapa-${step}-erros`;

  // --- edição do rascunho -------------------------------------------------

  function setFact(field: FactField, fact: DraftFact) {
    setDraft((current) => ({ ...current, [field]: fact }));
  }

  function setContact(update: Partial<ContactDraft>) {
    setDraft((current) => ({ ...current, contact: { ...current.contact, ...update } }));
  }

  function setAddress(update: Partial<AddressDraft>) {
    setDraft((current) => ({
      ...current,
      // Editing an address drops its confirmation and, unless the change came
      // from a lead suggestion, its lead attribution: what was checked is no
      // longer what would be published.
      contact: {
        ...current.contact,
        address: { ...current.contact.address, source: "OPERADOR", ...update, confirmedAt: null },
      },
    }));
  }

  function updateService(key: string, update: (service: ServiceDraft) => ServiceDraft) {
    setDraft((current) => ({
      ...current,
      services: current.services.map((service) => (service.key === key ? update(service) : service)),
    }));
  }

  function updateSocialLink(key: string, update: Partial<SocialLinkDraft>) {
    setDraft((current) => ({
      ...current,
      contact: {
        ...current.contact,
        socialLinks: current.contact.socialLinks.map((link) =>
          link.key === key ? editSocialLinkDraft(link, update) : link,
        ),
      },
    }));
  }

  function addSocialLink(link?: Partial<SocialLinkDraft>) {
    setDraft((current) => ({
      ...current,
      contact: {
        ...current.contact,
        socialLinks: [...current.contact.socialLinks, { ...createSocialLinkDraft(nextKey()), ...link }],
      },
    }));
  }

  /** Picking a lead pre-fills the project name when the operator has not typed one. */
  function chooseLead(lead: Lead) {
    setLeadId(lead.id);
    setProjectName((current) => (current.trim() ? current : `Site ${lead.name}`));
  }

  // --- envio --------------------------------------------------------------

  async function submit() {
    if (!selectedLead) return;
    const built = buildBriefV2(draft);
    if (!built.ok) {
      setAttempted((current) => ({ ...current, [step]: true }));
      setError(built.issues.map((issue) => issue.message).join(" · "));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: selectedLead.id,
          name: projectName.trim(),
          sector: draft.sector.value.trim(),
          brief: built.brief,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; capabilities?: BriefCapabilities; project?: { id?: string } }
        | null;

      if (!response.ok) {
        setError(describeApiError(payload?.error));
        setSubmitting(false);
        return;
      }

      const capabilities = payload?.capabilities ?? null;
      const projectId = payload?.project?.id;
      const destination = projectId ? `/projetos/${projectId}?gerar=1` : "/projetos";
      setCreatedPath(destination);
      if (!capabilities || capabilities.gaps.length === 0) {
        router.push(destination);
        router.refresh();
        return;
      }
      // Gaps are plain sentences about what the site will be missing. Walking
      // away without reading them is how a site ships without contact buttons.
      setOutcome(capabilities);
      setSubmitting(false);
    } catch {
      setError("Não foi possível criar o projeto. Tente novamente.");
      setSubmitting(false);
    }
  }

  function goForward() {
    if (stepIssues.length > 0) {
      setAttempted((current) => ({ ...current, [step]: true }));
      return;
    }
    setError(null);
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (outcome) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="rounded-3xl border border-amber-400/30 bg-amber-400/5 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
            Projeto criado
          </p>
          <h1 className="mt-3 flex items-start gap-3 text-2xl font-semibold tracking-tight text-white">
            <TriangleAlert className="mt-1 shrink-0 text-amber-300" size={22} aria-hidden="true" />
            O briefing foi salvo, mas ainda tem lacunas.
          </h1>
          <p className="mt-3 text-sm leading-6 text-amber-100/80">
            O site será gerado com o que está confirmado. Resolva os pontos abaixo no briefing do
            projeto para que nada fique de fora.
          </p>
          <ul className="mt-5 space-y-3">
            {outcome.gaps.map((gap) => (
              <li
                key={gap}
                className="flex items-start gap-3 rounded-2xl border border-nox-border bg-nox-bg/50 p-4 text-sm text-white"
              >
                <CircleAlert className="mt-0.5 shrink-0 text-amber-300" size={17} aria-hidden="true" />
                <span>{gap}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-5 grid gap-3 text-xs text-nox-muted sm:grid-cols-3">
            <div className="rounded-xl border border-nox-border bg-nox-bg/40 p-3">
              <dt>Versão do briefing</dt>
              <dd className="mt-1 font-mono text-sm text-white">v{outcome.schemaVersion}</dd>
            </div>
            <div className="rounded-xl border border-nox-border bg-nox-bg/40 p-3">
              <dt>Páginas de serviço</dt>
              <dd className="mt-1 text-sm text-white">
                {outcome.canGenerateServicePages ? "Disponíveis" : "Indisponíveis"}
              </dd>
            </div>
            <div className="rounded-xl border border-nox-border bg-nox-bg/40 p-3">
              <dt>Contato confirmado</dt>
              <dd className="mt-1 text-sm text-white">
                {outcome.hasConfirmedPublicContact ? "Sim" : "Não"}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              router.push(createdPath);
              router.refresh();
            }}
            className="nox-btn-primary mt-6"
          >
            Gerar o site agora <ArrowRight size={16} aria-hidden="true" />
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/projetos" className="inline-flex items-center gap-1.5 text-xs text-nox-muted hover:text-white">
            <ArrowLeft size={13} aria-hidden="true" /> Projetos
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Novo projeto</h1>
          <p className="mt-1.5 text-sm text-nox-muted">
            Do nicho ao script de venda. O site vem no fim, só com o que for confirmado.
          </p>
        </div>
        {selectedLead ? (
          <div className="nox-card-raised flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-nox-cyan/10 text-nox-cyan">
              <Building2 size={15} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-nox-muted">Negócio escolhido</span>
              <span className="block font-medium text-white">{selectedLead.name}</span>
            </span>
          </div>
        ) : null}
      </div>

      <Stepper step={step} />

      <section className="nox-card mt-6 min-h-[460px] p-5 sm:p-8">
        {step === 0 && (
          <Step
            title="Qual o setor do negócio?"
            description="Define o vocabulário, a estrutura e as regras do texto do site."
          >
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-nox-muted" aria-hidden="true" />
              <input
                id="buscar-setor"
                value={nicheQuery}
                onChange={(event) => setNicheQuery(event.target.value)}
                className="nox-input pl-11"
                placeholder="Buscar setor (ex.: pizzaria, advocacia, pet)"
                aria-label="Buscar setor"
              />
            </div>

            {visibleNiches.length > 0 ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {visibleNiches.map((niche) => {
                  const Icon = niche.icon;
                  const active = selectedNiche?.id === niche.id;
                  return (
                    <button
                      key={niche.id}
                      type="button"
                      onClick={() => setFact("sector", authoredFact(niche.label))}
                      aria-pressed={active}
                      className={cn(
                        "group relative flex items-start gap-3 rounded-2xl border p-4 text-left transition",
                        active
                          ? "border-nox-cyan bg-nox-cyan/10"
                          : "border-nox-border bg-nox-bg/40 hover:border-nox-border-strong hover:bg-nox-panel",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          active ? "bg-nox-cyan text-nox-bg" : "bg-nox-panel text-nox-cyan",
                        )}
                      >
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">{niche.label}</span>
                        <span className="mt-0.5 block text-xs text-nox-muted">{niche.hint}</span>
                      </span>
                      {active ? (
                        <Check size={16} className="absolute right-3 top-3 text-nox-cyan" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-nox-border p-6 text-center text-sm text-nox-muted">
                Nenhum setor com esse nome no catálogo.{" "}
                <button
                  type="button"
                  onClick={() => setFact("sector", authoredFact(nicheQuery.trim()))}
                  className="font-medium text-nox-cyan hover:underline"
                >
                  Usar “{nicheQuery.trim()}” como setor personalizado
                </button>
              </div>
            )}

            <TextField
              id="setor"
              label="Setor personalizado"
              className="mt-6 max-w-md"
              value={draft.sector.value}
              onChange={(value) => setFact("sector", authoredFact(value))}
              placeholder="Ex.: Clínica odontológica"
              hint="Escolha um card acima ou escreva o setor do seu jeito."
              invalid={isInvalid("sector")}
              describedBy={showIssues ? issuesId : undefined}
            />
          </Step>
        )}

        {step === 1 && (
          <Step
            title="Encontre seus clientes"
            description={
              selectedNiche
                ? `Negócios sem site próprio no nicho ${selectedNiche.label}, ordenados pela oportunidade. A ficha do lead permanece intocada.`
                : "Negócios sem site próprio, ordenados pela oportunidade. A ficha do lead permanece intocada."
            }
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-nox-muted" aria-hidden="true" />
                <input
                  value={leadQuery}
                  onChange={(event) => setLeadQuery(event.target.value)}
                  className="nox-input pl-11"
                  placeholder="Buscar por nome, bairro ou cidade"
                  aria-label="Buscar negócios"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", "Todos"],
                    ["high", "Score alto"],
                    ["phone", "Com telefone"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLeadFilter(value)}
                    aria-pressed={leadFilter === value}
                    className={cn("nox-chip", leadFilter === value && "nox-chip-active")}
                  >
                    {label}
                  </button>
                ))}
                <Link href="/leads/import" className="nox-btn-secondary px-3 py-1.5 text-xs">
                  <Search size={13} aria-hidden="true" /> Buscar novos negócios
                </Link>
              </div>
            </div>

            <p className="mt-4 text-xs text-nox-muted">
              {loadingLeads
                ? "Carregando oportunidades…"
                : `${filteredLeads.length} ${filteredLeads.length === 1 ? "negócio" : "negócios"} · ordenados por oportunidade`}
            </p>

            {loadingLeads ? (
              <p className="mt-6 flex items-center gap-2 text-sm text-nox-muted">
                <Loader2 className="animate-spin" size={16} aria-hidden="true" /> Carregando oportunidades…
              </p>
            ) : filteredLeads.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-nox-border p-8 text-center">
                <p className="text-sm text-white">Nenhum negócio encontrado com esses filtros.</p>
                <p className="mt-1 text-xs text-nox-muted">
                  Traga novos negócios pela prospecção ou limpe os filtros.
                </p>
                <Link href="/leads/import" className="nox-btn-primary mt-4">
                  <Search size={15} aria-hidden="true" /> Buscar negócios
                </Link>
              </div>
            ) : (
              <ul className="nox-scroll mt-3 max-h-[440px] space-y-2 overflow-y-auto pr-1">
                {filteredLeads.map((lead) => {
                  const active = leadId === lead.id;
                  const place = [lead.address, lead.neighborhood, lead.city, lead.state]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={lead.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-2xl border p-4 transition sm:flex-row sm:items-center",
                        active ? "border-nox-cyan bg-nox-cyan/10" : "border-nox-border bg-nox-bg/40 hover:border-nox-border-strong",
                      )}
                    >
                      <ScoreBadge score={lead.opportunityScore} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{lead.name}</span>
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                            {hasOwnWebsite(lead.website) ? "Com site" : "Sem site próprio"}
                          </span>
                          <span className="text-xs text-nox-muted">{lead.category}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nox-muted">
                          <span className="inline-flex items-center gap-1.5">
                            <Phone size={12} aria-hidden="true" /> {lead.phoneE164 ?? "Sem telefone"}
                          </span>
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <MapPin size={12} className="shrink-0" aria-hidden="true" />
                            <span className="truncate">{place || "Local não informado"}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          target="_blank"
                          className="nox-btn-ghost px-2.5 py-2 text-xs"
                          aria-label={`Abrir ficha de ${lead.name}`}
                        >
                          <ExternalLink size={14} aria-hidden="true" /> Ficha
                        </Link>
                        <button
                          type="button"
                          onClick={() => chooseLead(lead)}
                          aria-pressed={active}
                          className={cn(active ? "nox-btn-primary" : "nox-btn-secondary", "px-3.5 py-2 text-xs")}
                        >
                          {active ? (
                            <>
                              <Check size={14} aria-hidden="true" /> Selecionado
                            </>
                          ) : (
                            "Usar este negócio"
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Step>
        )}

        {step === 2 && (
          <Step
            title="Conte sobre o negócio"
            description="Os dados do lead aparecem como sugestões. Só entram no briefing quando você usa a sugestão."
          >
            <Section title="Identidade" text="O nome que aparece no site e como a operação chama este trabalho.">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  id="nome-negocio"
                  label="Nome do negócio"
                  value={draft.businessName.value}
                  onChange={(value) => setFact("businessName", authoredFact(value))}
                  placeholder="Como o negócio se apresenta"
                  hint="Vai para o site."
                  source={draft.businessName.source}
                  invalid={isInvalid("businessName")}
                  describedBy={showIssues ? issuesId : undefined}
                  suggestion={
                    selectedLead
                      ? {
                          label: selectedLead.name,
                          onUse: () => setFact("businessName", { value: selectedLead.name, source: "LEAD", confirmedAt: nowIso() }),
                        }
                      : undefined
                  }
                />
                <TextField
                  id="nome-projeto"
                  label="Nome do projeto"
                  value={projectName}
                  onChange={setProjectName}
                  placeholder="Site Nome do Negócio"
                  hint="Uso interno, não vai para o site."
                  invalid={isInvalid("projectName")}
                  describedBy={showIssues ? issuesId : undefined}
                />
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextField
                  id="setor-confirmado"
                  label="Setor"
                  value={draft.sector.value}
                  onChange={(value) => setFact("sector", authoredFact(value))}
                  source={draft.sector.source}
                  invalid={isInvalid("sector")}
                  suggestion={
                    selectedLead?.category && selectedLead.category !== draft.sector.value
                      ? {
                          label: selectedLead.category,
                          onUse: () =>
                            setFact("sector", { value: selectedLead.category, source: "LEAD", confirmedAt: nowIso() }),
                        }
                      : undefined
                  }
                />
                <TextField
                  id="cidade"
                  label="Cidade (opcional)"
                  value={draft.city.value}
                  onChange={(value) => setFact("city", authoredFact(value))}
                  source={draft.city.source}
                  invalid={isInvalid("city")}
                  suggestion={
                    selectedLead?.city
                      ? {
                          label: selectedLead.city,
                          onUse: () =>
                            setFact("city", { value: selectedLead.city ?? "", source: "LEAD", confirmedAt: nowIso() }),
                        }
                      : undefined
                  }
                />
              </div>
            </Section>

            <Section title="Objetivo do site" text="O que o cliente precisa conseguir fazer ao abrir a página." className="mt-5">
              <PresetChips
                presets={OBJECTIVE_PRESETS}
                current={draft.objective.value}
                onPick={(text) => setFact("objective", authoredFact(text))}
              />
              <TextField
                id="objetivo"
                label="Objetivo principal"
                className="mt-4"
                multiline
                value={draft.objective.value}
                onChange={(value) => setFact("objective", authoredFact(value))}
                placeholder="Ex.: Receber pedidos pelo WhatsApp a partir do site."
                invalid={isInvalid("objective")}
                describedBy={showIssues ? issuesId : undefined}
              />
            </Section>
          </Step>
        )}

        {step === 3 && (
          <Step
            title="Abordagem e posicionamento"
            description="Descreva apenas o que foi confirmado. Promessas, preços e avaliações não verificadas serão recusados."
          >
            <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <Section title="Tom de voz" text="Como o site fala com o cliente. Escolha um ponto de partida e ajuste.">
                  <PresetChips
                    presets={TONE_PRESETS}
                    current={draft.positioning.value}
                    onPick={(text) => setFact("positioning", authoredFact(text))}
                  />
                  <TextField
                    id="posicionamento"
                    label="Posicionamento"
                    className="mt-4"
                    multiline
                    value={draft.positioning.value}
                    onChange={(value) => setFact("positioning", authoredFact(value))}
                    invalid={isInvalid("positioning")}
                    describedBy={showIssues ? issuesId : undefined}
                  />
                </Section>

                <Section title="Direção visual" text="A sensação do site. Cores exatas ficam para o briefing visual.">
                  <PresetChips
                    presets={VISUAL_PRESETS}
                    current={draft.visualDirection.value}
                    onPick={(text) => setFact("visualDirection", authoredFact(text))}
                  />
                  <TextField
                    id="direcao-visual"
                    label="Direção visual"
                    className="mt-4"
                    multiline
                    value={draft.visualDirection.value}
                    onChange={(value) => setFact("visualDirection", authoredFact(value))}
                    invalid={isInvalid("visualDirection")}
                    describedBy={showIssues ? issuesId : undefined}
                  />
                </Section>

                <Section title="Público e diferenciais" text="Para quem o site fala e o que só este negócio pode afirmar.">
                  <TextField
                    id="publico"
                    label="Público"
                    multiline
                    value={draft.audience.value}
                    onChange={(value) => setFact("audience", authoredFact(value))}
                    placeholder="Ex.: famílias do bairro, condomínios e escritórios da região."
                    invalid={isInvalid("audience")}
                    describedBy={showIssues ? issuesId : undefined}
                  />
                  <TextField
                    id="diferenciais"
                    label="Diferenciais confirmados"
                    className="mt-4"
                    multiline
                    value={draft.differentiators.value}
                    onChange={(value) => setFact("differentiators", authoredFact(value))}
                    placeholder="Separe por vírgula. Deixe vazio se não houver confirmação."
                    invalid={isInvalid("differentiators")}
                  />
                  <TextField
                    id="meta-description"
                    label="Meta description (opcional)"
                    className="mt-4"
                    multiline
                    value={draft.metaDescription.value}
                    onChange={(value) => setFact("metaDescription", authoredFact(value))}
                    placeholder="Até 180 caracteres para o resultado de busca."
                    hint={`${draft.metaDescription.value.trim().length}/180 caracteres`}
                    invalid={isInvalid("metaDescription")}
                  />
                </Section>
              </div>

              <ApproachScript
                blocks={script}
                lead={selectedLead}
                sector={draft.sector.value}
                city={draft.city.value || selectedLead?.city || ""}
              />
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step
            title="Confirme o briefing"
            description="Cada serviço vira uma página. Cada canal de contato só é publicado depois de confirmado individualmente."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id="secoes"
                label="Seções desejadas"
                multiline
                value={draft.desiredSections}
                onChange={(value) => setDraft((current) => ({ ...current, desiredSections: value }))}
                placeholder="Separe por vírgula ou quebra de linha"
                invalid={isInvalid("desiredSections")}
                describedBy={showIssues ? issuesId : undefined}
              />
              <TextField
                id="observacoes"
                label="Observações confirmadas"
                multiline
                value={draft.notes.value}
                onChange={(value) => setFact("notes", authoredFact(value))}
                placeholder="Opcional"
                invalid={isInvalid("notes")}
              />
            </div>

            <fieldset className="mt-8">
              <legend className="text-sm font-semibold text-white">Serviços publicáveis</legend>
              <p className="mt-1 mb-4 text-xs text-nox-muted">
                Nome, resumo e ao menos um parágrafo de conteúdo. O identificador nasce do nome e
                não muda quando o nome muda — é ele que fica na URL.
              </p>
              <div className="space-y-4">
                {draft.services.map((service, index) => (
                  <ServiceCard
                    key={service.key}
                    service={service}
                    index={index}
                    others={draft.services.filter((other) => other.key !== service.key)}
                    invalid={isInvalid(`services.${index}`)}
                    onChange={(update) => updateService(service.key, update)}
                    onRemove={() =>
                      setDraft((current) => ({
                        ...current,
                        services: current.services.filter((other) => other.key !== service.key),
                      }))
                    }
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    services: [...current.services, createServiceDraft(nextKey())],
                  }))
                }
                className="nox-btn-secondary mt-4"
              >
                <Plus size={16} aria-hidden="true" /> Adicionar serviço
              </button>
            </fieldset>

            <ContactSection
              contact={draft.contact}
              lead={selectedLead}
              invalid={isInvalid}
              onContact={setContact}
              onAddress={setAddress}
              onAddressConfirm={(confirmed) =>
                setDraft((current) => ({
                  ...current,
                  contact: {
                    ...current.contact,
                    address: { ...current.contact.address, confirmedAt: confirmed ? nowIso() : null },
                  },
                }))
              }
              onSocialChange={updateSocialLink}
              onSocialAdd={addSocialLink}
              onSocialRemove={(key) =>
                setDraft((current) => ({
                  ...current,
                  contact: {
                    ...current.contact,
                    socialLinks: current.contact.socialLinks.filter((link) => link.key !== key),
                  },
                }))
              }
            />

            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-nox-cyan/20 bg-nox-cyan/5 p-4 text-sm text-cyan-100">
              <Sparkles className="mt-0.5 shrink-0 text-nox-cyan" size={17} aria-hidden="true" />
              <p>
                Ao criar, o sistema gera o cliente, o projeto e a primeira versão imutável do
                briefing, e informa o que ainda falta para o site ficar completo.
              </p>
            </div>
          </Step>
        )}

        {showIssues && (
          <div
            id={issuesId}
            role="alert"
            className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
          >
            <p className="font-semibold">Ajuste antes de continuar:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {stepIssues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
      </section>

      <div className="mt-5 flex items-center justify-between gap-4">
        <button
          type="button"
          disabled={step === 0 || submitting}
          onClick={() => {
            setError(null);
            setStep((value) => Math.max(0, value - 1));
          }}
          className="nox-btn-secondary disabled:opacity-30"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Voltar
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={goForward}
            aria-disabled={stepIssues.length > 0}
            className={cn("nox-btn-primary px-6", stepIssues.length > 0 && "opacity-50")}
          >
            Continuar <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            aria-disabled={stepIssues.length > 0}
            className={cn("nox-btn-primary px-6", stepIssues.length > 0 && "opacity-50")}
          >
            {submitting ? (
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
            Criar projeto
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Etapas do projeto">
      {STEPS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} className="min-w-0" aria-current={current ? "step" : undefined}>
            <div
              className={cn(
                "h-1 rounded-full transition-colors",
                done || current ? "bg-nox-cyan" : "bg-nox-border",
                current && "shadow-[0_0_12px_rgba(34,211,238,0.6)]",
              )}
            />
            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.16em]",
                current ? "text-nox-cyan" : done ? "text-white" : "text-nox-muted",
              )}
            >
              {done ? <Check size={12} aria-hidden="true" /> : <span className="font-mono">{index + 1}</span>}
              <span className="truncate">{label}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Step({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nox-fade-up">
      <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
      <p className="mt-2 mb-6 max-w-2xl text-sm text-nox-muted">{description}</p>
      {children}
    </div>
  );
}

function Section({
  title,
  text,
  className,
  children,
}: {
  title: string;
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-nox-border bg-nox-bg/40 p-5", className)}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 mb-4 text-xs text-nox-muted">{text}</p>
      {children}
    </section>
  );
}

function PresetChips({
  presets,
  current,
  onPick,
}: {
  presets: { label: string; text: string }[];
  current: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões">
      {presets.map((preset) => {
        const active = current.trim() === preset.text;
        return (
          <button
            key={preset.label}
            type="button"
            onClick={() => onPick(preset.text)}
            aria-pressed={active}
            className={cn("nox-chip", active && "nox-chip-active")}
          >
            {active ? <Check size={12} aria-hidden="true" /> : null}
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const band = opportunityBand(score);
  const tone =
    band === "alta"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : band === "media"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
        : "border-nox-border bg-nox-panel text-nox-muted";
  return (
    <span
      className={cn("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border font-mono", tone)}
      title={`Score de oportunidade ${score}`}
    >
      <span className="text-base font-semibold leading-none">{score}</span>
      <span className="mt-0.5 text-[9px] uppercase tracking-wider opacity-80">score</span>
    </span>
  );
}

function ApproachScript({
  blocks,
  lead,
  sector,
  city,
}: {
  blocks: ScriptBlock[];
  lead: Lead | null;
  sector: string;
  city: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopied(null);
    }
  }

  const everything = blocks.map((block) => block.text).join("\n\n");

  return (
    <aside className="rounded-2xl border border-nox-border bg-nox-bg/40 p-5" aria-label="Script de abordagem">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Sua abordagem profissional</h3>
          <p className="mt-1 text-xs text-nox-muted">Script de pré-venda em blocos. Use inteiro ou copie por etapa.</p>
        </div>
        <button type="button" onClick={() => void copy("all", everything)} className="nox-btn-secondary px-3 py-1.5 text-xs">
          {copied === "all" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied === "all" ? "Copiado" : "Copiar tudo"}
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["Empresa", lead?.name ?? "—"],
          ["Nicho", sector.trim() || "—"],
          ["Cidade", city.trim() || "—"],
          ["Meta do contato", "Agendar uma conversa"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-nox-border bg-nox-surface px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.16em] text-nox-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-white" title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      <ol className="mt-4 space-y-3">
        {blocks.map((block, index) => (
          <li key={block.title} className="rounded-xl border border-nox-border bg-nox-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white">
                  <span className="mr-1.5 text-nox-cyan">{index + 1}.</span>
                  {block.title}
                </p>
                <p className="mt-0.5 text-[11px] text-nox-muted">{block.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => void copy(block.title, block.text)}
                className="nox-btn-ghost p-1.5"
                aria-label={`Copiar bloco ${block.title}`}
              >
                {copied === block.title ? <Check size={14} className="text-emerald-300" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-nox-text/90">{block.text}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-100/90">
        <p>
          Ordem que funciona: mande a abordagem antes de gerar o site. Quem já demonstrou interesse
          aprova mais rápido.
        </p>
        {lead ? (
          <Link href={`/leads/${lead.id}#whatsapp`} target="_blank" className="mt-2 inline-flex items-center gap-1.5 font-medium text-emerald-300 hover:underline">
            <MessageCircle size={13} aria-hidden="true" /> Enviar pela ficha do lead (respeita o opt-in)
          </Link>
        ) : null}
      </div>
    </aside>
  );
}

const INPUT_CLASS = "nox-input mt-2";

function SourceBadge({ source }: { source: string }) {
  if (source !== "LEAD") return null;
  return (
    <span className="rounded-full border border-nox-cyan/40 bg-nox-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-nox-cyan">
      do lead
    </span>
  );
}

function Suggestion({ label, onUse }: { label: string; onUse: () => void }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-nox-muted">
      <span className="truncate">
        Do lead: <span className="text-white">{label}</span> — confirme para usar
      </span>
      <button
        type="button"
        onClick={onUse}
        className="rounded-full border border-nox-cyan/40 px-3 py-1 text-[11px] font-semibold text-nox-cyan hover:bg-nox-cyan/10"
      >
        Usar
      </button>
    </p>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  multiline = false,
  placeholder,
  hint,
  className = "",
  invalid = false,
  describedBy,
  source,
  suggestion,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  source?: string;
  suggestion?: { label: string; onUse: () => void };
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const described = [describedBy, hintId].filter(Boolean).join(" ") || undefined;
  const border = invalid ? "border-red-400/60" : "";
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm text-nox-muted">
          {label}
        </label>
        {source ? <SourceBadge source={source} /> : null}
      </div>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT_CLASS} ${border}`}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT_CLASS} ${border}`}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
        />
      )}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-nox-muted">
          {hint}
        </p>
      ) : null}
      {suggestion ? <Suggestion label={suggestion.label} onUse={suggestion.onUse} /> : null}
    </div>
  );
}

/** A field that reaches the payload only after an explicit confirmation. */
function ConfirmableField({
  id,
  label,
  fact,
  onValue,
  onConfirm,
  placeholder,
  hint,
  invalid = false,
  suggestion,
}: {
  id: string;
  label: string;
  fact: DraftFact;
  onValue: (value: string) => void;
  onConfirm: (confirmed: boolean) => void;
  placeholder?: string;
  hint?: string;
  invalid?: boolean;
  suggestion?: { label: string; onUse: () => void };
}) {
  const confirmed = isFactConfirmed(fact);
  const filled = fact.value.trim().length > 0;
  return (
    <div>
      <TextField
        id={id}
        label={label}
        value={fact.value}
        onChange={onValue}
        placeholder={placeholder}
        hint={hint}
        invalid={invalid}
        source={fact.source}
        suggestion={suggestion}
      />
      <label
        htmlFor={`${id}-confirmado`}
        className={`mt-2 inline-flex items-center gap-2 text-xs ${confirmed ? "text-emerald-300" : "text-nox-muted"}`}
      >
        <input
          id={`${id}-confirmado`}
          type="checkbox"
          checked={confirmed}
          disabled={!filled}
          onChange={(event) => onConfirm(event.target.checked)}
          className="size-4 accent-emerald-400 disabled:opacity-40"
        />
        {confirmed ? "Confirmado — será publicado" : "Confirmado (sem isto, não é enviado)"}
      </label>
    </div>
  );
}

function ServiceCard({
  service,
  index,
  others,
  invalid,
  onChange,
  onRemove,
}: {
  service: ServiceDraft;
  index: number;
  others: ServiceDraft[];
  invalid: boolean;
  onChange: (update: (service: ServiceDraft) => ServiceDraft) => void;
  onRemove: () => void;
}) {
  const base = `servico-${service.key}`;
  return (
    <fieldset
      className={`rounded-2xl border bg-nox-bg/40 p-4 ${invalid ? "border-red-400/50" : "border-nox-border"}`}
    >
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-nox-muted">
        Serviço {index + 1}
      </legend>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id={`${base}-nome`}
          label="Nome"
          value={service.name}
          onChange={(value) => onChange((current) => renameServiceDraft(current, value))}
          // Leaving the name freezes the id: from here on a rename is only a
          // rename, and the URL the service will be published at stays put.
          onBlur={() => onChange(pinServiceId)}
          placeholder="Ex.: Limpeza de pele"
        />
        <TextField
          id={`${base}-id`}
          label="Identificador (URL)"
          value={service.id}
          onChange={(value) => onChange((current) => setServiceId(current, value))}
          placeholder="limpeza-de-pele"
          hint="Nasce do nome e permanece fixo depois disso."
        />
      </div>
      <TextField
        id={`${base}-resumo`}
        label="Resumo"
        className="mt-4"
        multiline
        value={service.summary}
        onChange={(value) => onChange((current) => ({ ...current, summary: value, confirmedAt: nowIso() }))}
        placeholder="Uma frase que descreve o serviço. Até 320 caracteres."
        hint={`${service.summary.trim().length}/320 caracteres`}
      />
      <TextField
        id={`${base}-conteudo`}
        label="Conteúdo da página"
        className="mt-4"
        multiline
        value={service.body}
        onChange={(value) => onChange((current) => ({ ...current, body: value, confirmedAt: nowIso() }))}
        placeholder="Um parágrafo por linha. Ao menos um."
        hint="Cada linha vira um parágrafo confirmado."
      />
      <TextField
        id={`${base}-preco`}
        label="Preço (opcional)"
        className="mt-4 max-w-xs"
        value={service.price}
        onChange={(value) => onChange((current) => ({ ...current, price: value, confirmedAt: nowIso() }))}
        placeholder="R$ 28,00 · a partir de R$ 90 · sob consulta"
        hint="Aparece no cardápio ou na lista de serviços exatamente como escrito."
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${base}-destaque`} className="inline-flex items-center gap-2 text-xs text-nox-muted">
          <input
            id={`${base}-destaque`}
            type="checkbox"
            checked={service.featured}
            onChange={(event) => onChange((current) => ({ ...current, featured: event.target.checked }))}
            className="size-4 accent-nox-cyan"
          />
          Destacar na página inicial
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-red-400/50 hover:text-red-200"
        >
          <Trash2 size={14} aria-hidden="true" /> Remover serviço
        </button>
      </div>
      {others.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-xs text-nox-muted">Serviços relacionados (opcional)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((other) => {
              const checked = service.relatedIds.includes(other.id);
              const disabled = !other.id;
              return (
                <label
                  key={other.key}
                  htmlFor={`${base}-rel-${other.key}`}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${checked ? "border-nox-cyan text-white" : "border-nox-border text-nox-muted"} ${disabled ? "opacity-40" : ""}`}
                >
                  <input
                    id={`${base}-rel-${other.key}`}
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        relatedIds: event.target.checked
                          ? [...current.relatedIds, other.id]
                          : current.relatedIds.filter((id) => id !== other.id),
                      }))
                    }
                    className="size-3.5 accent-nox-cyan"
                  />
                  {other.name.trim() || other.id || "sem nome"}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </fieldset>
  );
}

function ContactSection({
  contact,
  lead,
  invalid,
  onContact,
  onAddress,
  onAddressConfirm,
  onSocialChange,
  onSocialAdd,
  onSocialRemove,
}: {
  contact: ContactDraft;
  lead: Lead | null;
  invalid: (field: string) => boolean;
  onContact: (update: Partial<ContactDraft>) => void;
  onAddress: (update: Partial<AddressDraft>) => void;
  onAddressConfirm: (confirmed: boolean) => void;
  onSocialChange: (key: string, update: Partial<SocialLinkDraft>) => void;
  onSocialAdd: (link?: Partial<SocialLinkDraft>) => void;
  onSocialRemove: (key: string) => void;
}) {
  const phonePreview = normalizePhoneE164(contact.phone.value);
  const whatsappPreview = normalizePhoneE164(contact.whatsapp.value);
  const addressConfirmed = Boolean(contact.address.confirmedAt) && addressHasContent(contact.address);

  return (
    <fieldset className="mt-8">
      <legend className="text-sm font-semibold text-white">Contato público</legend>
      <p className="mt-1 mb-4 text-xs text-nox-muted">
        Cada canal é confirmado por conta própria. Um campo preenchido e não confirmado não é
        enviado, e a ficha do lead nunca é copiada sozinha.
      </p>

      <div className="grid gap-5 md:grid-cols-2">
        <ConfirmableField
          id="contato-telefone"
          label="Telefone"
          fact={contact.phone}
          onValue={(value) => onContact({ phone: typedFact(value) })}
          onConfirm={(confirmed) => onContact({ phone: setFactConfirmed(contact.phone, confirmed) })}
          placeholder="(85) 99999-0000"
          hint={phonePreview ? `Será gravado como ${phonePreview}` : "Use DDD + número."}
          invalid={invalid("publicContact.phone")}
          suggestion={
            lead?.phoneE164
              ? {
                  label: lead.phoneE164,
                  onUse: () => onContact({ phone: suggestedFact(lead?.phoneE164 ?? "") }),
                }
              : undefined
          }
        />
        <ConfirmableField
          id="contato-whatsapp"
          label="WhatsApp"
          fact={contact.whatsapp}
          onValue={(value) => onContact({ whatsapp: typedFact(value) })}
          onConfirm={(confirmed) => onContact({ whatsapp: setFactConfirmed(contact.whatsapp, confirmed) })}
          placeholder="(85) 99999-0000"
          hint={whatsappPreview ? `Será gravado como ${whatsappPreview}` : "Use DDD + número."}
          invalid={invalid("publicContact.whatsapp")}
          suggestion={
            lead?.phoneE164
              ? {
                  label: lead.phoneE164,
                  onUse: () => onContact({ whatsapp: suggestedFact(lead?.phoneE164 ?? "") }),
                }
              : undefined
          }
        />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <ConfirmableField
          id="contato-email"
          label="E-mail"
          fact={contact.email}
          onValue={(value) => onContact({ email: typedFact(value) })}
          onConfirm={(confirmed) => onContact({ email: setFactConfirmed(contact.email, confirmed) })}
          placeholder="contato@negocio.com.br"
          invalid={invalid("publicContact.email")}
        />
      </div>

      <fieldset
        className={`mt-6 rounded-2xl border bg-nox-bg/40 p-4 ${invalid("publicContact.address") ? "border-red-400/50" : "border-nox-border"}`}
      >
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-nox-muted">
          Endereço
        </legend>
        {lead?.address ? (
          <Suggestion
            label={[lead.address, lead.city, lead.state].filter(Boolean).join(", ")}
            onUse={() =>
              onAddress({
                street: lead?.address ?? "",
                city: lead?.city ?? "",
                state: lead?.state ?? "",
                neighborhood: lead?.neighborhood ?? "",
                postalCode: lead?.postalCode ?? "",
                source: "LEAD",
              })
            }
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="endereco-logradouro"
            label="Logradouro"
            value={contact.address.street}
            onChange={(value) => onAddress({ street: value })}
            source={contact.address.source}
          />
          <TextField
            id="endereco-numero"
            label="Número"
            value={contact.address.number}
            onChange={(value) => onAddress({ number: value })}
          />
          <TextField
            id="endereco-complemento"
            label="Complemento"
            value={contact.address.complement}
            onChange={(value) => onAddress({ complement: value })}
          />
          <TextField
            id="endereco-bairro"
            label="Bairro"
            value={contact.address.neighborhood}
            onChange={(value) => onAddress({ neighborhood: value })}
          />
          <TextField
            id="endereco-cidade"
            label="Cidade"
            value={contact.address.city}
            onChange={(value) => onAddress({ city: value })}
          />
          <TextField
            id="endereco-estado"
            label="Estado"
            value={contact.address.state}
            onChange={(value) => onAddress({ state: value })}
          />
          <TextField
            id="endereco-cep"
            label="CEP"
            value={contact.address.postalCode}
            onChange={(value) => onAddress({ postalCode: value })}
          />
          <TextField
            id="endereco-pais"
            label="País"
            value={contact.address.country}
            onChange={(value) => onAddress({ country: value })}
          />
        </div>
        <label
          htmlFor="endereco-confirmado"
          className={`mt-3 inline-flex items-center gap-2 text-xs ${addressConfirmed ? "text-emerald-300" : "text-nox-muted"}`}
        >
          <input
            id="endereco-confirmado"
            type="checkbox"
            checked={addressConfirmed}
            disabled={!addressHasContent(contact.address)}
            onChange={(event) => onAddressConfirm(event.target.checked)}
            className="size-4 accent-emerald-400 disabled:opacity-40"
          />
          {addressConfirmed ? "Endereço confirmado — será publicado" : "Confirmar endereço (sem isto, não é enviado)"}
        </label>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wider text-nox-muted">
          Redes sociais
        </legend>
        {lead && lead.socialLinks.length > 0 ? (
          <div className="mt-2 space-y-1">
            {lead.socialLinks.map((url) => (
              <Suggestion
                key={url}
                label={url}
                onUse={() =>
                  onSocialAdd({ platform: guessSocialPlatform(url) ?? "INSTAGRAM", url, source: "LEAD" })
                }
              />
            ))}
          </div>
        ) : null}
        <div className="mt-3 space-y-3">
          {contact.socialLinks.map((link, index) => (
            <div
              key={link.key}
              className={`rounded-2xl border bg-nox-bg/40 p-4 ${invalid(`publicContact.socialLinks.${index}`) ? "border-red-400/50" : "border-nox-border"}`}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor={`rede-${link.key}-plataforma`} className="text-sm text-nox-muted">
                    Plataforma
                  </label>
                  <select
                    id={`rede-${link.key}-plataforma`}
                    value={link.platform}
                    onChange={(event) =>
                      onSocialChange(link.key, {
                        platform: event.target.value as BriefSocialPlatform,
                      })
                    }
                    className={INPUT_CLASS}
                  >
                    {SOCIAL_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {SOCIAL_PLATFORM_LABELS[platform]}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  id={`rede-${link.key}-url`}
                  label="Endereço (https)"
                  value={link.url}
                  onChange={(value) =>
                    onSocialChange(link.key, { url: value })
                  }
                  placeholder="https://instagram.com/perfil"
                  source={link.source}
                />
                <TextField
                  id={`rede-${link.key}-rotulo`}
                  label="Rótulo (opcional)"
                  value={link.label}
                  onChange={(value) => onSocialChange(link.key, { label: value })}
                  placeholder="@perfil"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label
                  htmlFor={`rede-${link.key}-confirmado`}
                  className={`inline-flex items-center gap-2 text-xs ${link.confirmedAt ? "text-emerald-300" : "text-nox-muted"}`}
                >
                  <input
                    id={`rede-${link.key}-confirmado`}
                    type="checkbox"
                    checked={Boolean(link.confirmedAt)}
                    disabled={!link.url.trim()}
                    onChange={(event) =>
                      onSocialChange(link.key, { confirmedAt: event.target.checked ? nowIso() : null })
                    }
                    className="size-4 accent-emerald-400 disabled:opacity-40"
                  />
                  {link.confirmedAt ? "Confirmado — será publicado" : "Confirmado (sem isto, não é enviado)"}
                </label>
                <button
                  type="button"
                  onClick={() => onSocialRemove(link.key)}
                  className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-red-400/50 hover:text-red-200"
                >
                  <Trash2 size={14} aria-hidden="true" /> Remover
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onSocialAdd()}
          className="nox-btn-secondary mt-3"
        >
          <Plus size={16} aria-hidden="true" /> Adicionar rede social
        </button>
      </fieldset>
    </fieldset>
  );
}
