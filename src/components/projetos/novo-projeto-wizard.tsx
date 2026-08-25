"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, Sparkles } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  category: string;
  city: string | null;
  neighborhood: string | null;
  opportunityScore: number;
};

const STEPS = ["Setor", "Lead", "Negócio", "Abordagem", "Briefing"];

export function NewProjectWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sector, setSector] = useState("");
  const [leadId, setLeadId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [objective, setObjective] = useState("Criar um site completo para apresentar o negócio e facilitar novos contatos.");
  const [audience, setAudience] = useState("Pessoas que procuram os serviços do negócio na região.");
  const [positioning, setPositioning] = useState("Apresentar informações confirmadas com clareza e credibilidade.");
  const [visualDirection, setVisualDirection] = useState("Visual contemporâneo, legível e adequado ao setor.");
  const [services, setServices] = useState("");
  const [differentiators, setDifferentiators] = useState("");
  const [sections, setSections] = useState("Início, Sobre, Serviços, Contato");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/leads?pageSize=100&sort=score_desc")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os leads.");
        return response.json() as Promise<{ items: Lead[] }>;
      })
      .then((payload) => { if (active) setLeads(payload.items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Falha ao carregar leads."); })
      .finally(() => { if (active) setLoadingLeads(false); });
    return () => { active = false; };
  }, []);

  const categories = useMemo(
    () => [...new Set(leads.map((lead) => lead.category).filter(Boolean))].sort(),
    [leads],
  );
  const filteredLeads = useMemo(
    () => leads.filter((lead) => !sector || lead.category === sector),
    [leads, sector],
  );
  const selectedLead = leads.find((lead) => lead.id === leadId) ?? null;

  function canContinue() {
    if (step === 0) return Boolean(sector.trim());
    if (step === 1) return Boolean(selectedLead);
    if (step === 2) return Boolean(projectName.trim() && objective.trim());
    if (step === 3) return Boolean(audience.trim() && positioning.trim() && visualDirection.trim());
    return Boolean(sections.trim());
  }

  function fact(value: string) {
    return { value: value.trim(), source: "OPERADOR" as const, confirmedAt: new Date().toISOString() };
  }

  function splitList(value: string) {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  async function submit() {
    if (!selectedLead || !canContinue()) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessId: selectedLead.id,
        name: projectName.trim(),
        sector: sector.trim(),
        brief: {
          schemaVersion: 1,
          businessName: fact(selectedLead.name),
          sector: fact(sector),
          city: selectedLead.city ? fact(selectedLead.city) : null,
          objective: fact(objective),
          audience: fact(audience),
          positioning: fact(positioning),
          services: splitList(services).map(fact),
          differentiators: splitList(differentiators).map(fact),
          desiredSections: splitList(sections),
          visualDirection: fact(visualDirection),
          notes: notes.trim() ? fact(notes) : null,
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok) {
      setError(typeof payload?.error === "string" ? payload.error : "Revise o briefing: há campos inválidos ou afirmações sem confirmação.");
      setSubmitting(false);
      return;
    }
    router.push("/projetos");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-nox-cyan">Novo projeto</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Transforme um lead em briefing executável.</h1>
        <p className="mt-3 text-sm leading-6 text-nox-muted">Cinco decisões curtas. Nenhum dado de contato é copiado, e toda afirmação fica ligada à sua fonte.</p>
      </div>

      <ol className="mb-6 grid grid-cols-5 gap-2" aria-label="Etapas do projeto">
        {STEPS.map((label, index) => (
          <li key={label} className="min-w-0">
            <div className={`h-1 rounded-full ${index <= step ? "bg-gradient-to-r from-nox-purple to-nox-cyan" : "bg-nox-border"}`} />
            <p className={`mt-2 truncate text-[11px] sm:text-xs ${index === step ? "text-white" : "text-nox-muted"}`}>{index + 1}. {label}</p>
          </li>
        ))}
      </ol>

      <section className="min-h-[430px] rounded-3xl border border-nox-border bg-nox-surface p-5 shadow-2xl shadow-black/20 sm:p-8">
        {step === 0 && (
          <Step title="Qual setor será atendido?" description="O setor orienta linguagem, estrutura e direção visual.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <button key={category} type="button" onClick={() => setSector(category)} className={`rounded-2xl border p-4 text-left text-sm transition ${sector === category ? "border-nox-cyan bg-nox-cyan/10 text-white" : "border-nox-border bg-nox-bg/40 text-nox-muted hover:border-nox-purple hover:text-white"}`}>
                  <Building2 className="mb-3" size={19} /><span className="font-medium">{category}</span>
                </button>
              ))}
            </div>
            <label className="mt-5 block text-sm text-nox-muted">Outro setor
              <input value={sector} onChange={(event) => setSector(event.target.value)} className="mt-2 w-full rounded-xl border border-nox-border bg-nox-bg px-4 py-3 text-white outline-none focus:border-nox-cyan" placeholder="Ex.: Clínica odontológica" />
            </label>
          </Step>
        )}

        {step === 1 && (
          <Step title="Escolha a oportunidade" description="Exibimos leads sem site próprio, priorizados pelo score de oportunidade.">
            {loadingLeads ? <p className="flex items-center gap-2 text-sm text-nox-muted"><Loader2 className="animate-spin" size={16} /> Carregando oportunidades…</p> : (
              <div className="grid max-h-[330px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredLeads.map((lead) => (
                  <button key={lead.id} type="button" onClick={() => { setLeadId(lead.id); if (!projectName) setProjectName(`Site ${lead.name}`); }} className={`rounded-2xl border p-4 text-left transition ${leadId === lead.id ? "border-nox-cyan bg-nox-cyan/10" : "border-nox-border bg-nox-bg/40 hover:border-nox-purple"}`}>
                    <div className="flex items-start justify-between gap-3"><span className="font-medium text-white">{lead.name}</span><span className="font-mono text-sm text-nox-cyan">{lead.opportunityScore}</span></div>
                    <p className="mt-2 text-xs text-nox-muted">{lead.category} · {[lead.neighborhood, lead.city].filter(Boolean).join(", ") || "Local não informado"}</p>
                  </button>
                ))}
              </div>
            )}
          </Step>
        )}

        {step === 2 && (
          <Step title="Defina o negócio do projeto" description="O nome identifica a operação; o objetivo diz o que o site precisa resolver.">
            <Field label="Nome do projeto" value={projectName} onChange={setProjectName} placeholder="Site Nome do Negócio" />
            <Field label="Objetivo principal" value={objective} onChange={setObjective} multiline />
            {selectedLead && <div className="mt-5 rounded-2xl border border-nox-border bg-nox-bg/40 p-4 text-sm"><p className="text-nox-muted">Lead vinculado</p><p className="mt-1 font-medium text-white">{selectedLead.name}</p><p className="mt-1 text-xs text-nox-muted">Contato, endereço e redes continuam na ficha original.</p></div>}
          </Step>
        )}

        {step === 3 && (
          <Step title="Escolha a abordagem" description="Descreva apenas o que foi confirmado. Promessas, preços e avaliações não verificadas serão recusados.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Público" value={audience} onChange={setAudience} multiline />
              <Field label="Posicionamento" value={positioning} onChange={setPositioning} multiline />
            </div>
            <Field label="Direção visual" value={visualDirection} onChange={setVisualDirection} multiline />
          </Step>
        )}

        {step === 4 && (
          <Step title="Confirme o briefing" description="Listas podem ser separadas por vírgula ou quebra de linha.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Serviços confirmados" value={services} onChange={setServices} multiline placeholder="Ex.: Serviço A, Serviço B" />
              <Field label="Diferenciais confirmados" value={differentiators} onChange={setDifferentiators} multiline placeholder="Deixe vazio se não houver confirmação" />
              <Field label="Seções desejadas" value={sections} onChange={setSections} multiline />
              <Field label="Observações confirmadas" value={notes} onChange={setNotes} multiline placeholder="Opcional" />
            </div>
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-100"><Sparkles className="mt-0.5 shrink-0" size={17} /><p>Ao criar, o sistema gera o cliente, o projeto e a primeira versão imutável do briefing.</p></div>
          </Step>
        )}

        {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      </section>

      <div className="mt-5 flex items-center justify-between gap-4">
        <button type="button" disabled={step === 0 || submitting} onClick={() => { setError(null); setStep((value) => Math.max(0, value - 1)); }} className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm text-nox-muted hover:text-white disabled:opacity-30"><ArrowLeft size={16} /> Voltar</button>
        {step < STEPS.length - 1 ? (
          <button type="button" disabled={!canContinue()} onClick={() => { setError(null); setStep((value) => Math.min(STEPS.length - 1, value + 1)); }} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-nox-bg disabled:opacity-30">Continuar <ArrowRight size={16} /></button>
        ) : (
          <button type="button" disabled={!canContinue() || submitting} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-nox-purple to-nox-cyan px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{submitting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />} Criar projeto</button>
        )}
      </div>
    </div>
  );
}

function Step({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div><h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2><p className="mt-2 mb-6 text-sm text-nox-muted">{description}</p>{children}</div>;
}

function Field({ label, value, onChange, multiline = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  const className = "mt-2 w-full rounded-xl border border-nox-border bg-nox-bg px-4 py-3 text-sm text-white outline-none placeholder:text-nox-muted/60 focus:border-nox-cyan";
  return <label className="block text-sm text-nox-muted">{label}{multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className={className} placeholder={placeholder} /> : <input value={value} onChange={(event) => onChange(event.target.value)} className={className} placeholder={placeholder} />}</label>;
}
