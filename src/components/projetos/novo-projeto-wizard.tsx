"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Loader2,
  Plus,
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
import { normalizePhoneE164 } from "@/lib/phone";

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
  socialLinks: string[];
  opportunityScore: number;
};

const STEPS = ["Setor", "Lead", "Negócio", "Abordagem", "Briefing"];

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

export function NewProjectWizard() {
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

  const categories = useMemo(
    () => [...new Set(leads.map((lead) => lead.category).filter(Boolean))].sort(),
    [leads],
  );
  /**
   * The sector narrows the list, it does not gate it.
   *
   * An exact category match meant that typing a sector of your own — which the
   * field invites — emptied the list and left the wizard unable to advance.
   * A loose match keeps the filter useful, and a sector that matches nothing
   * falls back to every lead instead of to none.
   */
  const filteredLeads = useMemo(
    () => {
      const sector = draft.sector.value.trim().toLowerCase();
      if (!sector) return leads;
      const matching = leads.filter((lead) => {
        const category = lead.category.toLowerCase();
        return category.includes(sector) || sector.includes(category);
      });
      return matching.length > 0 ? matching : leads;
    },
    [leads, draft.sector.value],
  );
  const selectedLead = leads.find((lead) => lead.id === leadId) ?? null;

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
      own.push({ field: "lead", message: "Escolha o lead que origina o projeto." });
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
          link.key === key ? { ...link, ...update } : link,
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
        | { error?: unknown; capabilities?: BriefCapabilities }
        | null;

      if (!response.ok) {
        setError(describeApiError(payload?.error));
        setSubmitting(false);
        return;
      }

      const capabilities = payload?.capabilities ?? null;
      if (!capabilities || capabilities.gaps.length === 0) {
        router.push("/projetos");
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
              router.push("/projetos");
              router.refresh();
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-nox-bg"
          >
            Ir para os projetos <ArrowRight size={16} aria-hidden="true" />
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">Novo projeto</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Transforme um lead em briefing executável.
        </h1>
        <p className="mt-3 text-sm leading-6 text-nox-muted">
          Cinco decisões curtas. Nada do lead entra no site sem confirmação campo a campo.
        </p>
      </div>

      <ol className="mb-6 grid grid-cols-5 gap-2" aria-label="Etapas do projeto">
        {STEPS.map((label, index) => (
          <li key={label} className="min-w-0" aria-current={index === step ? "step" : undefined}>
            <div
              className={`h-1 rounded-full ${index <= step ? "bg-gradient-to-r from-nox-purple to-nox-cyan" : "bg-nox-border"}`}
            />
            <p className={`mt-2 truncate text-[11px] sm:text-xs ${index === step ? "text-white" : "text-nox-muted"}`}>
              {index + 1}. {label}
            </p>
          </li>
        ))}
      </ol>

      <section className="min-h-[430px] rounded-3xl border border-nox-border bg-nox-surface p-5 shadow-2xl shadow-black/20 sm:p-8">
        {step === 0 && (
          <Step title="Qual setor será atendido?" description="O setor orienta linguagem, estrutura e direção visual.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFact("sector", authoredFact(category))}
                  aria-pressed={draft.sector.value === category}
                  className={`rounded-2xl border p-4 text-left text-sm transition ${draft.sector.value === category ? "border-nox-cyan bg-nox-cyan/10 text-white" : "border-nox-border bg-nox-bg/40 text-nox-muted hover:border-nox-purple hover:text-white"}`}
                >
                  <Building2 className="mb-3" size={19} aria-hidden="true" />
                  <span className="font-medium">{category}</span>
                </button>
              ))}
            </div>
            <TextField
              id="setor"
              label="Outro setor"
              className="mt-5"
              value={draft.sector.value}
              onChange={(value) => setFact("sector", authoredFact(value))}
              placeholder="Ex.: Clínica odontológica"
              invalid={isInvalid("sector")}
              describedBy={showIssues ? issuesId : undefined}
            />
          </Step>
        )}

        {step === 1 && (
          <Step
            title="Escolha a oportunidade"
            description="Exibimos leads sem site próprio, priorizados pelo score de oportunidade. A ficha do lead permanece intocada."
          >
            {loadingLeads ? (
              <p className="flex items-center gap-2 text-sm text-nox-muted">
                <Loader2 className="animate-spin" size={16} aria-hidden="true" /> Carregando oportunidades…
              </p>
            ) : (
              <div className="grid max-h-[330px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setLeadId(lead.id)}
                    aria-pressed={leadId === lead.id}
                    className={`rounded-2xl border p-4 text-left transition ${leadId === lead.id ? "border-nox-cyan bg-nox-cyan/10" : "border-nox-border bg-nox-bg/40 hover:border-nox-purple"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-white">{lead.name}</span>
                      <span className="font-mono text-sm text-nox-cyan">{lead.opportunityScore}</span>
                    </div>
                    <p className="mt-2 text-xs text-nox-muted">
                      {lead.category} ·{" "}
                      {[lead.neighborhood, lead.city].filter(Boolean).join(", ") || "Local não informado"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Step>
        )}

        {step === 2 && (
          <Step
            title="Defina o negócio do projeto"
            description="Os dados do lead aparecem como sugestões. Só entram no briefing quando você usa a sugestão."
          >
            <TextField
              id="nome-projeto"
              label="Nome do projeto"
              value={projectName}
              onChange={setProjectName}
              placeholder="Site Nome do Negócio"
              invalid={isInvalid("projectName")}
              describedBy={showIssues ? issuesId : undefined}
              suggestion={
                selectedLead
                  ? { label: `Site ${selectedLead.name}`, onUse: () => setProjectName(`Site ${selectedLead.name}`) }
                  : undefined
              }
            />
            <TextField
              id="nome-negocio"
              label="Nome do negócio"
              className="mt-4"
              value={draft.businessName.value}
              onChange={(value) => setFact("businessName", authoredFact(value))}
              placeholder="Como o negócio se apresenta"
              hint="Vai para o site. Escreva ou use a sugestão do lead."
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
            <div className="mt-4 grid gap-4 md:grid-cols-2">
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
              <TextField
                id="setor-confirmado"
                label="Setor"
                value={draft.sector.value}
                onChange={(value) => setFact("sector", authoredFact(value))}
                source={draft.sector.source}
                invalid={isInvalid("sector")}
                suggestion={
                  selectedLead?.category
                    ? {
                        label: selectedLead.category,
                        onUse: () =>
                          setFact("sector", { value: selectedLead.category, source: "LEAD", confirmedAt: nowIso() }),
                      }
                    : undefined
                }
              />
            </div>
            <TextField
              id="objetivo"
              label="Objetivo principal"
              className="mt-4"
              multiline
              value={draft.objective.value}
              onChange={(value) => setFact("objective", authoredFact(value))}
              invalid={isInvalid("objective")}
              describedBy={showIssues ? issuesId : undefined}
            />
          </Step>
        )}

        {step === 3 && (
          <Step
            title="Escolha a abordagem"
            description="Descreva apenas o que foi confirmado. Promessas, preços e avaliações não verificadas serão recusados."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id="publico"
                label="Público"
                multiline
                value={draft.audience.value}
                onChange={(value) => setFact("audience", authoredFact(value))}
                invalid={isInvalid("audience")}
                describedBy={showIssues ? issuesId : undefined}
              />
              <TextField
                id="posicionamento"
                label="Posicionamento"
                multiline
                value={draft.positioning.value}
                onChange={(value) => setFact("positioning", authoredFact(value))}
                invalid={isInvalid("positioning")}
                describedBy={showIssues ? issuesId : undefined}
              />
            </div>
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
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField
                id="diferenciais"
                label="Diferenciais confirmados"
                multiline
                value={draft.differentiators.value}
                onChange={(value) => setFact("differentiators", authoredFact(value))}
                placeholder="Separe por vírgula. Deixe vazio se não houver confirmação."
                invalid={isInvalid("differentiators")}
              />
              <TextField
                id="meta-description"
                label="Meta description (opcional)"
                multiline
                value={draft.metaDescription.value}
                onChange={(value) => setFact("metaDescription", authoredFact(value))}
                placeholder="Até 180 caracteres para o resultado de busca."
                hint={`${draft.metaDescription.value.trim().length}/180 caracteres`}
                invalid={isInvalid("metaDescription")}
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
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm text-nox-muted hover:border-nox-purple hover:text-white"
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

            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-100">
              <Sparkles className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
              <p>
                Ao criar, o sistema gera o cliente, o projeto e a primeira versão imutável do
                briefing na versão 2, e informa o que ainda falta.
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
          className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm text-nox-muted hover:text-white disabled:opacity-30"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Voltar
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={goForward}
            aria-disabled={stepIssues.length > 0}
            className={`inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-nox-bg ${stepIssues.length > 0 ? "opacity-40" : ""}`}
          >
            Continuar <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            aria-disabled={stepIssues.length > 0}
            className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-nox-purple to-nox-cyan px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${stepIssues.length > 0 ? "opacity-40" : ""}`}
          >
            {submitting ? (
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
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
    <div>
      <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
      <p className="mt-2 mb-6 text-sm text-nox-muted">{description}</p>
      {children}
    </div>
  );
}

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-nox-border bg-nox-bg px-4 py-3 text-sm text-white outline-none placeholder:text-nox-muted/60 focus:border-nox-cyan";

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
                        confirmedAt: null,
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
                    onSocialChange(link.key, { url: value, source: "OPERADOR", confirmedAt: null })
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
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm text-nox-muted hover:border-nox-purple hover:text-white"
        >
          <Plus size={16} aria-hidden="true" /> Adicionar rede social
        </button>
      </fieldset>
    </fieldset>
  );
}
