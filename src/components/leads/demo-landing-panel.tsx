"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEMO_CTA_LABELS,
  demoLandingContentSchema,
  normalizeDemoCtaLabel,
  type DemoLandingContent,
} from "@/lib/demo-landing-schema";

type DemoLanding = {
  id: string;
  leadId?: string;
  slug: string;
  status: "DRAFT" | "APPROVED" | "EXPIRED";
  expiresAt: string;
  content: EditableLandingContent;
  publicUrl?: string;
  previewUrl?: string;
  approvedAt?: string | null;
};

type DemoFaq = DemoLandingContent["faqs"][number];
type EditableLandingContent = DemoLandingContent;

type Draft = Omit<
  EditableLandingContent,
  "benefits" | "services" | "processSteps" | "faqs"
> & {
  benefits: string;
  services: string;
  processSteps: string;
  faqs: DemoFaq[];
};

type Props = {
  leadId: string;
  leadName: string;
  eligible: boolean;
  whatsappBlocked: boolean;
  message: string;
  onMessageChange: (message: string) => void;
};

const EMPTY_DRAFT: Draft = {
  headline: "",
  subheadline: "",
  aboutTitle: "Sobre",
  about: "",
  factsTitle: "Destaques",
  benefits: "",
  servicesTitle: "Serviços",
  servicesIntro: "",
  services: "",
  processTitle: "Como funciona",
  processIntro: "",
  processSteps: "",
  faqTitle: "Perguntas frequentes",
  faqs: [],
  finalCtaTitle: "Vamos conversar?",
  finalCtaText: "",
  ctaLabel: "Ver informações",
  primaryColor: "#111827",
  accentColor: "#22d3ee",
};

const STATUS_LABELS: Record<DemoLanding["status"], string> = {
  DRAFT: "Rascunho",
  APPROVED: "Aprovada",
  EXPIRED: "Expirada",
};

export function DemoLandingPanel({
  leadId,
  leadName,
  eligible,
  whatsappBlocked,
  message,
  onMessageChange,
}: Props) {
  const [landing, setLanding] = useState<DemoLanding | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [expiresOn, setExpiresOn] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [loading, setLoading] = useState(eligible);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyLanding = useCallback((next: DemoLanding | null) => {
    setLanding(next);
    if (next) {
      setDraft(toDraft(next.content));
      setExpiresOn(toDateInput(next.expiresAt));
    } else {
      setDraft(EMPTY_DRAFT);
      setExpiresOn("");
    }
    setDirty(false);
  }, []);

  const loadLanding = useCallback(async () => {
    if (!eligible) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/demo-landings?leadId=${encodeURIComponent(leadId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, "Não foi possível carregar a demonstração."));
      }
      const payload = (await response.json()) as { landing: DemoLanding | null };
      applyLanding(payload.landing ?? null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [applyLanding, eligible, leadId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadLanding(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadLanding]);

  const previewUrl = useMemo(
    () => landing?.publicUrl ?? landing?.previewUrl ?? (landing ? `/demo/${landing.slug}` : null),
    [landing],
  );

  const shareUrl = useMemo(() => {
    if (!previewUrl || typeof window === "undefined") return previewUrl;
    return new URL(previewUrl, window.location.origin).toString();
  }, [previewUrl]);
  const today = new Date().toISOString().slice(0, 10);
  const expiryInvalid = !expiresOn || expiresOn < today;

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }

  function updateFaq(index: number, key: keyof DemoFaq, value: string) {
    setDraft((current) => ({
      ...current,
      faqs: current.faqs.map((faq, faqIndex) =>
        faqIndex === index ? { ...faq, [key]: value } : faq,
      ),
    }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }

  function addFaq() {
    if (draft.faqs.length >= 6) return;
    updateDraft("faqs", [...draft.faqs, { question: "", answer: "" }]);
  }

  function removeFaq(index: number) {
    updateDraft(
      "faqs",
      draft.faqs.filter((_, faqIndex) => faqIndex !== index),
    );
  }

  async function createLanding() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/demo-landings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, expiresInDays: Number(expiresInDays) }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Não foi possível gerar a demonstração."));
      }
      const payload = (await response.json()) as { landing: DemoLanding };
      applyLanding(payload.landing);
      setNotice("Demonstração criada. Revise os textos antes de aprovar.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function updateLanding(status?: DemoLanding["status"]) {
    if (!landing) return;
    const parsedContent = demoLandingContentSchema.safeParse(toContent(draft));
    if (!parsedContent.success) {
      const issue = parsedContent.error.issues[0];
      setError(
        `Revise ${validationFieldLabel(issue?.path ?? [])}: ${issue?.message ?? "campo inválido"}.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextStatus =
        status ?? (landing.status === "APPROVED" && dirty ? "DRAFT" : undefined);
      const response = await fetch(`/api/demo-landings/${landing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: parsedContent.data,
          expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : undefined,
          status: nextStatus,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "Não foi possível salvar a demonstração."));
      }
      const payload = (await response.json()) as { landing: DemoLanding };
      applyLanding(payload.landing);
      setNotice(
        status === "APPROVED"
          ? "Demonstração aprovada."
          : nextStatus === "DRAFT"
            ? "Alterações salvas. Revise e aprove novamente antes de compartilhar."
            : "Alterações salvas.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyPreviewLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Link da demonstração copiado.");
      setError(null);
    } catch {
      setError("Não foi possível copiar automaticamente. Abra a prévia e copie o endereço.");
    }
  }

  function addToWhatsAppMessage() {
    if (!shareUrl || whatsappBlocked || landing?.status !== "APPROVED") return;
    if (message.includes(shareUrl)) {
      setNotice("O link já está na mensagem do WhatsApp.");
      return;
    }
    const line = `Preparei uma demonstração para ${leadName}: ${shareUrl}`;
    onMessageChange([message.trim(), line].filter(Boolean).join("\n\n"));
    setNotice("Link incluído na mensagem. Revise tudo antes de abrir o WhatsApp.");
  }

  if (!eligible) {
    return (
      <section className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4" aria-labelledby="demo-title">
        <h2 id="demo-title" className="font-medium text-white">
          Landing demonstrativa
        </h2>
        <p className="mt-2 text-sm text-amber-200">
          Este lead já possui site próprio e não é elegível para uma demonstração. O NOX OS gera
          prévias apenas para empresas sem site identificado.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-nox-border bg-nox-surface p-4" aria-labelledby="demo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="demo-title" className="font-medium text-white">
              Landing demonstrativa
            </h2>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-200">
              Sem custo de API
            </span>
            {landing && (
              <span className="rounded-full border border-nox-border px-2 py-0.5 text-xs text-nox-muted">
                {STATUS_LABELS[landing.status]}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-nox-muted">
            O conteúdo é criado por um modelo automático e fica marcado como demonstração não
            oficial. Revise e confirme cada informação antes de compartilhar.
          </p>
        </div>
        {landing && previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan"
          >
            Abrir prévia ↗
          </a>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-nox-muted">Carregando demonstração…</p>}

      {!loading && !landing && (
        <div className="mt-4 rounded-xl border border-dashed border-nox-border bg-nox-bg/40 p-4">
          <h3 className="text-sm font-medium text-white">Criar uma prévia para este lead</h3>
          <p className="mt-1 text-sm text-nox-muted">
            Usa somente os dados cadastrados e textos genéricos da categoria. Nenhuma IA paga será
            chamada.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm text-nox-muted">
              Validade
              <select
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="mt-1 block rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
              >
                <option value="7">7 dias</option>
                <option value="14">14 dias</option>
                <option value="30">30 dias</option>
                <option value="60">60 dias</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createLanding()}
              className="rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Gerando…" : "Gerar landing demonstrativa"}
            </button>
          </div>
        </div>
      )}

      {!loading && landing && (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">
            Não inclua avaliações, preços, horários, promoções ou serviços que não estejam
            confirmados na ficha da empresa.
          </div>

          <div className="space-y-3">
            <EditorSection
              title="1. Topo e identidade"
              description="Título, texto inicial, botão e cores."
              defaultOpen
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título principal"
                  value={draft.headline}
                  maxLength={120}
                  onChange={(value) => updateDraft("headline", value)}
                />
                <label className="text-sm text-nox-muted">
                  Chamada do botão
                  <select
                    value={draft.ctaLabel}
                    onChange={(event) => updateDraft("ctaLabel", event.target.value)}
                    className="mt-1 block w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
                  >
                    {DEMO_CTA_LABELS.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs">Leva para os dados do estabelecimento.</span>
                </label>
                <TextAreaField
                  label="Subtítulo"
                  value={draft.subheadline}
                  maxLength={320}
                  onChange={(value) => updateDraft("subheadline", value)}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField
                    label="Cor principal"
                    value={draft.primaryColor}
                    onChange={(value) => updateDraft("primaryColor", value)}
                  />
                  <ColorField
                    label="Cor de destaque"
                    value={draft.accentColor}
                    onChange={(value) => updateDraft("accentColor", value)}
                  />
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title="2. Sobre e destaques"
              description="Apresentação institucional e dados disponíveis."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção Sobre"
                  value={draft.aboutTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("aboutTitle", value)}
                />
                <TextField
                  label="Título dos destaques"
                  value={draft.factsTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("factsTitle", value)}
                />
                <TextAreaField
                  label="Sobre a empresa"
                  hint="Use somente informações presentes na ficha."
                  value={draft.about}
                  maxLength={1200}
                  onChange={(value) => updateDraft("about", value)}
                />
                <TextAreaField
                  label="Informações disponíveis"
                  hint="Um item por linha; no máximo 8."
                  value={draft.benefits}
                  maxLength={1448}
                  onChange={(value) => updateDraft("benefits", value)}
                />
              </div>
            </EditorSection>

            <EditorSection
              title="3. Serviços"
              description="Exiba apenas serviços já confirmados."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção"
                  value={draft.servicesTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("servicesTitle", value)}
                />
                <TextAreaField
                  label="Introdução dos serviços"
                  value={draft.servicesIntro}
                  maxLength={600}
                  onChange={(value) => updateDraft("servicesIntro", value)}
                />
                <div className="lg:col-span-2">
                  <TextAreaField
                    label="Serviços confirmados"
                    hint="Um por linha; no máximo 12. Deixe vazio se não foram confirmados."
                    value={draft.services}
                    maxLength={2172}
                    onChange={(value) => updateDraft("services", value)}
                  />
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title="4. Como funciona"
              description="Explique o processo sem prometer resultados."
              defaultOpen={
                toLines(draft.processSteps).length < 3 ||
                toLines(draft.processSteps).length > 4
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção"
                  value={draft.processTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("processTitle", value)}
                />
                <TextAreaField
                  label="Introdução do processo"
                  value={draft.processIntro}
                  maxLength={600}
                  onChange={(value) => updateDraft("processIntro", value)}
                />
                <div className="lg:col-span-2">
                  <TextAreaField
                    label="Etapas"
                    hint="Use 3 ou 4 etapas, uma por linha; até 180 caracteres por item."
                    value={draft.processSteps}
                    maxLength={724}
                    onChange={(value) => updateDraft("processSteps", value)}
                  />
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title="5. Perguntas frequentes"
              description={`${draft.faqs.length}/6 perguntas cadastradas.`}
              defaultOpen={draft.faqs.some(
                (faq) => !faq.question.trim() || !faq.answer.trim(),
              )}
            >
              <TextField
                label="Título da seção"
                value={draft.faqTitle}
                maxLength={120}
                onChange={(value) => updateDraft("faqTitle", value)}
              />

              <div className="mt-4 space-y-3">
                {draft.faqs.length === 0 && (
                  <p className="rounded-lg border border-dashed border-nox-border p-4 text-sm text-nox-muted">
                    Nenhuma pergunta cadastrada. Adicione apenas respostas confirmadas.
                  </p>
                )}
                {draft.faqs.map((faq, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-nox-border bg-nox-bg/50 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-medium text-white">Pergunta {index + 1}</h4>
                      <button
                        type="button"
                        onClick={() => removeFaq(index)}
                        className="rounded-md border border-red-400/30 px-2.5 py-1 text-xs text-red-200 hover:border-red-400"
                        aria-label={`Remover pergunta ${index + 1}`}
                      >
                        Remover
                      </button>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <TextField
                        label="Pergunta"
                        value={faq.question}
                        maxLength={180}
                        onChange={(value) => updateFaq(index, "question", value)}
                      />
                      <TextAreaField
                        label="Resposta"
                        hint="Não invente horários, preços ou condições."
                        value={faq.answer}
                        maxLength={600}
                        onChange={(value) => updateFaq(index, "answer", value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={draft.faqs.length >= 6}
                onClick={addFaq}
                className="mt-3 rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                {draft.faqs.length >= 6 ? "Limite de 6 perguntas" : "+ Adicionar pergunta"}
              </button>
            </EditorSection>

            <EditorSection
              title="6. Chamada final"
              description="Fechamento da página antes do contato."
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da chamada final"
                  value={draft.finalCtaTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("finalCtaTitle", value)}
                />
                <TextAreaField
                  label="Texto da chamada final"
                  value={draft.finalCtaText}
                  maxLength={600}
                  onChange={(value) => updateDraft("finalCtaText", value)}
                />
              </div>
            </EditorSection>
          </div>

          <div className="rounded-lg border border-nox-border bg-nox-bg/40 p-4">
            <h3 className="text-sm font-medium text-white">Publicação</h3>
            <label className="mt-3 block max-w-xs text-sm text-nox-muted">
              Válida até
              <input
                type="date"
                value={expiresOn}
                min={today}
                onChange={(event) => {
                  setExpiresOn(event.target.value);
                  setDirty(true);
                  setNotice(null);
                  setError(null);
                }}
                className="mt-1 block w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-nox-border pt-4">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void updateLanding()}
              className="rounded-lg border border-nox-border px-4 py-2 text-sm font-medium text-white hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Salvando…" : "Salvar alterações"}
            </button>
            {landing.status !== "APPROVED" && (
              <button
                type="button"
                disabled={busy || expiryInvalid}
                onClick={() => void updateLanding("APPROVED")}
                className="rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Aprovar demonstração
              </button>
            )}
            <button
              type="button"
              disabled={
                landing.status !== "APPROVED" || !shareUrl || dirty || expiryInvalid
              }
              onClick={() => void copyPreviewLink()}
              className="rounded-lg border border-nox-border px-4 py-2 text-sm text-nox-cyan disabled:opacity-40"
            >
              Copiar link
            </button>
            <button
              type="button"
              disabled={
                landing.status !== "APPROVED" ||
                whatsappBlocked ||
                !shareUrl ||
                dirty ||
                expiryInvalid
              }
              onClick={addToWhatsAppMessage}
              className="rounded-lg border border-emerald-400/40 px-4 py-2 text-sm font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Incluir na mensagem do WhatsApp
            </button>
          </div>

          {dirty && (
            <p className="text-xs text-amber-200">
              Há alterações não salvas. Salve para atualizar a prévia.
            </p>
          )}
          {landing.status === "APPROVED" && whatsappBlocked && (
            <p className="text-xs text-nox-muted">
              O link poderá ser incluído na mensagem após telefone e opt-in verificado, sem
              supressão de contato.
            </p>
          )}
          {expiryInvalid && (
            <p className="text-xs text-red-300">
              Escolha uma validade a partir de hoje para aprovar a demonstração.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="mt-4 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-red-300">
          <span>{error}</span>
          {!loading && (
            <button type="button" className="underline" onClick={() => void loadLanding()}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EditorSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group rounded-lg border border-nox-border bg-nox-bg/30"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm text-white marker:text-nox-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nox-cyan">
        <span className="ml-1 inline-flex flex-col gap-0.5 align-middle">
          <span className="font-medium">{title}</span>
          <span className="text-xs font-normal text-nox-muted">{description}</span>
        </span>
      </summary>
      <div className="border-t border-nox-border p-4">{children}</div>
    </details>
  );
}

function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-nox-muted">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
      />
    </label>
  );
}

function TextAreaField({
  label,
  hint,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-nox-muted">
      {label}
      {hint && <span className="ml-1 text-xs">· {hint}</span>}
      <textarea
        value={value}
        maxLength={maxLength}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full resize-y rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-nox-muted">
      {label}
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-white">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="font-mono text-xs uppercase">{value}</span>
      </span>
    </label>
  );
}

function toDraft(content: EditableLandingContent): Draft {
  return {
    headline: content.headline ?? "",
    subheadline: content.subheadline ?? "",
    aboutTitle: content.aboutTitle ?? "Sobre",
    about: content.about ?? "",
    factsTitle: content.factsTitle ?? "Destaques",
    benefits: Array.isArray(content.benefits) ? content.benefits.join("\n") : "",
    servicesTitle: content.servicesTitle ?? "Serviços",
    servicesIntro: content.servicesIntro ?? "",
    services: Array.isArray(content.services) ? content.services.join("\n") : "",
    processTitle: content.processTitle ?? "Como funciona",
    processIntro: content.processIntro ?? "",
    processSteps: Array.isArray(content.processSteps) ? content.processSteps.join("\n") : "",
    faqTitle: content.faqTitle ?? "Perguntas frequentes",
    faqs: Array.isArray(content.faqs)
      ? content.faqs.slice(0, 6).map((faq) => ({
          question: faq.question ?? "",
          answer: faq.answer ?? "",
        }))
      : [],
    finalCtaTitle: content.finalCtaTitle ?? "Vamos conversar?",
    finalCtaText: content.finalCtaText ?? "",
    ctaLabel: normalizeDemoCtaLabel(content.ctaLabel ?? ""),
    primaryColor: validHex(content.primaryColor) ? content.primaryColor : "#111827",
    accentColor: validHex(content.accentColor) ? content.accentColor : "#22d3ee",
  };
}

function toContent(draft: Draft): EditableLandingContent {
  return {
    ...draft,
    headline: draft.headline.trim(),
    subheadline: draft.subheadline.trim(),
    aboutTitle: draft.aboutTitle.trim(),
    about: draft.about.trim(),
    factsTitle: draft.factsTitle.trim(),
    benefits: toLines(draft.benefits),
    servicesTitle: draft.servicesTitle.trim(),
    servicesIntro: draft.servicesIntro.trim(),
    services: toLines(draft.services),
    processTitle: draft.processTitle.trim(),
    processIntro: draft.processIntro.trim(),
    processSteps: toLines(draft.processSteps),
    faqTitle: draft.faqTitle.trim(),
    faqs: draft.faqs.map((faq) => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
    })),
    finalCtaTitle: draft.finalCtaTitle.trim(),
    finalCtaText: draft.finalCtaText.trim(),
    ctaLabel: draft.ctaLabel.trim(),
  };
}

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean);
}

function validHex(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

function validationFieldLabel(path: readonly PropertyKey[]): string {
  const root = String(path[0] ?? "");
  if (root === "faqs") {
    const position = typeof path[1] === "number" ? path[1] + 1 : null;
    const part = path[2] === "question" ? "a pergunta" : "a resposta";
    return position ? `${part} da FAQ ${position}` : "as perguntas frequentes";
  }
  if (root === "processSteps") return "as etapas de como funciona";
  if (root === "benefits") return "as informações disponíveis";
  if (root === "services") return "os serviços";

  const labels: Record<string, string> = {
    headline: "o título principal",
    subheadline: "o subtítulo",
    aboutTitle: "o título da seção Sobre",
    about: "o texto Sobre a empresa",
    factsTitle: "o título das informações",
    servicesTitle: "o título dos serviços",
    servicesIntro: "a introdução dos serviços",
    processTitle: "o título de Como funciona",
    processIntro: "a introdução de Como funciona",
    faqTitle: "o título das perguntas frequentes",
    finalCtaTitle: "o título da chamada final",
    finalCtaText: "o texto da chamada final",
    ctaLabel: "a chamada do botão",
  };
  return labels[root] ?? "o conteúdo";
}

function toDateInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: string | { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    };
    if (typeof payload.error === "string") return payload.error;
    const fieldError = payload.error?.fieldErrors
      ? Object.values(payload.error.fieldErrors).flat()[0]
      : undefined;
    return payload.error?.formErrors?.[0] ?? fieldError ?? fallback;
  } catch {
    return fallback;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Ocorreu um erro inesperado.";
}
