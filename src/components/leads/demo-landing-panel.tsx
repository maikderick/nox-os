"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DEMO_CTA_LABELS,
  demoLandingContentSchema,
  isDemoStockPhotoUrl as isStockPhotoUrl,
  isSafeDemoImageUrl,
  normalizeDemoCtaLabel,
  type DemoLandingContent,
} from "@/lib/demo-landing-schema";
import { findInstagramProfile, isInstagramPostUrl } from "@/lib/instagram";
import {
  buildLovableBriefing,
  buildLovableBuildUrl,
  LOVABLE_PROMPT_MAX,
} from "@/lib/lovable";
import { StockPhotoPicker, type PickerPhoto } from "@/components/leads/stock-photo-picker";

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
type DemoGalleryImage = DemoLandingContent["galleryImages"][number];
type EditableLandingContent = DemoLandingContent;

type Draft = Omit<
  EditableLandingContent,
  "benefits" | "services" | "processSteps" | "faqs" | "galleryImages" | "instagramPosts"
> & {
  benefits: string;
  services: string;
  processSteps: string;
  instagramPosts: string;
  faqs: DemoFaq[];
  galleryImages: DemoGalleryImage[];
};

type Props = {
  leadId: string;
  leadName: string;
  leadCategory: string;
  leadSocialLinks?: string[];
  eligible: boolean;
  whatsappBlocked: boolean;
  message: string;
  onMessageChange: (message: string) => void;
};

const DEFAULT_GALLERY_TITLE = "Uma presença digital mais completa";
const DEFAULT_GALLERY_INTRO =
  "Esta seção está pronta para receber fotos oficiais ou autorizadas. Enquanto não houver imagens, a demonstração exibirá composições visuais claramente identificadas como ilustrativas.";
const DEFAULT_CONTACT_TITLE = "Informações de contato";
const DEFAULT_CONTACT_TEXT =
  "Valide os canais informados diretamente com o estabelecimento antes de entrar em contato.";

const EMPTY_DRAFT: Draft = {
  headline: "",
  subheadline: "",
  heroImageUrl: "",
  heroImageKind: "official",
  heroImageCredit: null,
  heroImageCreditUrl: "",
  builtSiteUrl: "",
  aboutTitle: "Sobre",
  about: "",
  factsTitle: "Destaques",
  benefits: "",
  servicesTitle: "Serviços",
  servicesIntro: "",
  services: "",
  galleryTitle: DEFAULT_GALLERY_TITLE,
  galleryIntro: DEFAULT_GALLERY_INTRO,
  galleryImages: [],
  instagramTitle: "No Instagram",
  instagramIntro: "",
  instagramPosts: "",
  processTitle: "Como funciona",
  processIntro: "",
  processSteps: "",
  faqTitle: "Perguntas frequentes",
  faqs: [],
  contactTitle: DEFAULT_CONTACT_TITLE,
  contactText: DEFAULT_CONTACT_TEXT,
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

type AiSuggestion = {
  content: EditableLandingContent;
  changedFields: string[];
  droppedServices: string[];
  model: string;
};

const AI_FIELD_LABELS: Record<string, string> = {
  headline: "Título principal",
  subheadline: "Subtítulo",
  aboutTitle: "Título da seção Sobre",
  about: "Sobre a empresa",
  factsTitle: "Título dos destaques",
  benefits: "Informações disponíveis",
  servicesTitle: "Título dos serviços",
  servicesIntro: "Introdução dos serviços",
  services: "Serviços confirmados",
  galleryTitle: "Título da galeria",
  galleryIntro: "Introdução da galeria",
  processTitle: "Título de Como funciona",
  processIntro: "Introdução de Como funciona",
  processSteps: "Etapas",
  faqTitle: "Título das perguntas frequentes",
  faqs: "Perguntas frequentes",
  contactTitle: "Título da seção de contato",
  contactText: "Texto de contato",
  finalCtaTitle: "Título da chamada final",
  finalCtaText: "Texto da chamada final",
  ctaLabel: "Chamada do botão",
  primaryColor: "Cor principal",
  accentColor: "Cor de destaque",
};

function describeFieldValue(value: unknown): string {
  if (typeof value === "string") return value || "—";
  if (!Array.isArray(value)) return "—";
  if (value.length === 0) return "— (vazio)";
  return value
    .map((item) =>
      typeof item === "string"
        ? `• ${item}`
        : `• ${(item as DemoFaq).question} → ${(item as DemoFaq).answer}`,
    )
    .join("\n");
}

export function DemoLandingPanel({
  leadId,
  leadName,
  leadCategory,
  leadSocialLinks = [],
  eligible,
  whatsappBlocked,
  message,
  onMessageChange,
}: Props) {
  const [landing, setLanding] = useState<DemoLanding | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [expiresOn, setExpiresOn] = useState("");
  const expiresInDays = "14";
  const [loading, setLoading] = useState(eligible);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  /** Null means "follow the generated briefing"; a string is a manual override. */
  const [lovablePromptOverride, setLovablePromptOverride] = useState<string | null>(null);

  const applyLanding = useCallback((next: DemoLanding | null) => {
    setLanding(next);
    setSuggestion(null);
    setAiError(null);
    setLovablePromptOverride(null);
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
      const payload = (await response.json()) as {
        landing: DemoLanding | null;
        ai?: { configured?: boolean };
      };
      setAiConfigured(Boolean(payload.ai?.configured));
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

  const instagramProfile = useMemo(
    () => findInstagramProfile(leadSocialLinks),
    [leadSocialLinks],
  );
  const instagramPostLines = useMemo(
    () => toLines(draft.instagramPosts),
    [draft.instagramPosts],
  );
  const instagramPostCount = instagramPostLines.length;
  const invalidInstagramPosts = useMemo(
    () => instagramPostLines.filter((line) => !isInstagramPostUrl(line)),
    [instagramPostLines],
  );

  // Built from the demo already saved, so the briefing never carries unsaved edits.
  const lovableBriefing = useMemo(() => {
    if (!landing) return null;
    return buildLovableBriefing({
      content: landing.content,
      demoUrl: shareUrl && shareUrl.startsWith("https://") ? shareUrl : null,
    });
  }, [landing, shareUrl]);

  const lovablePrompt = lovablePromptOverride ?? lovableBriefing?.prompt ?? "";

  /** Served from the demo's own address, so it dies with the demo. */
  const builtSiteShareUrl = useMemo(() => {
    if (!landing?.content.builtSiteUrl?.trim() || typeof window === "undefined") return null;
    return new URL(`/demo/${landing.slug}/site`, window.location.origin).toString();
  }, [landing]);

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

  function updateGalleryImage(index: number, key: "url" | "alt", value: string) {
    setDraft((current) => ({
      ...current,
      galleryImages: current.galleryImages.map((galleryImage, imageIndex) => {
        if (imageIndex !== index) return galleryImage;
        // A hand-typed URL is a photo the reviewer supplied, so the stock credit
        // and the "illustrative" label must not stay attached to it.
        if (key === "url" && !isStockPhotoUrl(value)) {
          return { ...galleryImage, url: value, kind: "official", credit: null, creditUrl: "" };
        }
        return { ...galleryImage, [key]: value };
      }),
    }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }

  function addGalleryImage() {
    if (draft.galleryImages.length >= 6) return;
    updateDraft("galleryImages", [
      ...draft.galleryImages,
      { url: "", alt: "", kind: "official", credit: null, creditUrl: "" },
    ]);
  }

  function addStockPhotoToGallery(photo: PickerPhoto) {
    if (draft.galleryImages.length >= 6) return;
    if (draft.galleryImages.some((galleryImage) => galleryImage.url === photo.url)) {
      setNotice("Esta foto já está na galeria.");
      return;
    }
    updateDraft("galleryImages", [
      ...draft.galleryImages,
      { ...photo, kind: "stock" as const },
    ]);
    setNotice("Foto ilustrativa adicionada. Salve para atualizar a prévia.");
  }

  function useStockPhotoAsHero(photo: PickerPhoto) {
    setDraft((current) => ({
      ...current,
      heroImageUrl: photo.url,
      heroImageKind: "stock",
      heroImageCredit: photo.credit,
      heroImageCreditUrl: photo.creditUrl,
    }));
    setDirty(true);
    setError(null);
    setNotice("Foto definida como imagem do topo. Salve para atualizar a prévia.");
  }

  function updateHeroImageUrl(value: string) {
    setDraft((current) => ({
      ...current,
      heroImageUrl: value,
      ...(isStockPhotoUrl(value)
        ? {}
        : { heroImageKind: "official" as const, heroImageCredit: null, heroImageCreditUrl: "" }),
    }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }

  function removeGalleryImage(index: number) {
    updateDraft(
      "galleryImages",
      draft.galleryImages.filter((_, imageIndex) => imageIndex !== index),
    );
  }

  async function createLanding(options: { regenerate?: boolean } = {}) {
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
      setNotice(
        options.regenerate
          ? "Demonstração gerada novamente com o endereço e o conteúdo atualizados. Revise antes de aprovar."
          : "Demonstração criada. Revise os textos antes de aprovar.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Regeneration replaces every edited text and mints a new address, so the old
   * link stops working. Worth a confirmation before discarding reviewed copy.
   */
  function confirmRegenerate() {
    const confirmed = window.confirm(
      "Gerar novamente substitui todos os textos e imagens desta demonstração pelo conteúdo automático, cria um novo endereço e devolve a página para rascunho. O link atual deixa de funcionar. Deseja continuar?",
    );
    if (confirmed) void createLanding({ regenerate: true });
  }

  async function improveWithClaude() {
    if (!landing) return;
    setAiBusy(true);
    setAiError(null);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/demo-landings/${landing.id}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Não foi possível melhorar a demonstração com o Claude. Nada foi alterado.",
          ),
        );
      }
      const payload = (await response.json()) as { suggestion: AiSuggestion };
      if (!payload.suggestion?.changedFields?.length) {
        setSuggestion(null);
        setNotice("O Claude não sugeriu mudanças no conteúdo editorial.");
        return;
      }
      setSuggestion(payload.suggestion);
    } catch (cause) {
      setAiError(errorMessage(cause));
    } finally {
      setAiBusy(false);
    }
  }

  function applySuggestion() {
    if (!suggestion) return;
    setDraft(toDraft(suggestion.content));
    setSuggestion(null);
    setDirty(true);
    setAiError(null);
    setError(null);
    setNotice(
      "Sugestão aplicada ao rascunho. Revise, salve e aprove antes de compartilhar o link.",
    );
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

  async function copyLovablePrompt() {
    if (!lovablePrompt.trim()) return;
    try {
      await navigator.clipboard.writeText(lovablePrompt);
      setNotice("Prompt mestre copiado.");
      setError(null);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o texto do prompt e copie.");
    }
  }

  function openInLovable() {
    if (!lovableBriefing || !lovablePrompt.trim()) return;
    const url = buildLovableBuildUrl({
      prompt: lovablePrompt,
      images: lovableBriefing.images,
      htmlRefs: lovableBriefing.htmlRefs,
    });
    // The prompt travels in the URL fragment, so it never reaches a server log.
    window.open(url, "_blank", "noopener,noreferrer");
    setNotice("Lovable aberto em outra aba com o prompt já preenchido.");
  }

  async function copyBuiltSiteLink() {
    if (!builtSiteShareUrl) return;
    try {
      await navigator.clipboard.writeText(builtSiteShareUrl);
      setNotice("Link do site copiado.");
      setError(null);
    } catch {
      setError("Não foi possível copiar automaticamente. Copie o endereço exibido ao lado.");
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
            {landing && (
              <span className="rounded-full border border-nox-border px-2 py-0.5 text-xs text-nox-muted">
                {STATUS_LABELS[landing.status]}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-nox-muted">
            O conteúdo é criado por um gerador automático e fica marcado como demonstração não
            oficial. Depois, se quiser, o Claude pode melhorar apenas os textos — sempre como
            rascunho. Revise e confirme cada informação antes de compartilhar.
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
          <h3 className="text-sm font-medium text-white">Crie um projeto de site completo</h3>
          <p className="mt-1 text-sm text-nox-muted">
            O gerador de demonstrações entrou em modo de compatibilidade. Novos trabalhos começam
            na fábrica de sites, com briefing versionado e aprovação separada.
          </p>
          <Link href="/projetos/novo" className="mt-4 inline-flex rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">
            Abrir novo projeto
          </Link>
        </div>
      )}

      {!loading && landing && (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">
            Não inclua avaliações, preços, horários, promoções ou serviços que não estejam
            confirmados na ficha da empresa.
          </div>

          <div className="rounded-xl border border-nox-border bg-nox-bg/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-white">Melhorar com Claude</h3>
                  <span className="rounded-full border border-nox-purple/40 bg-nox-purple/10 px-2 py-0.5 text-xs text-purple-200">
                    Opcional · usa a API da Anthropic
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-nox-muted">
                  Reescreve apenas títulos, textos, benefícios, etapas, FAQ, chamadas e cores.
                  Telefone, endereço, mapa, redes sociais, fotos, endereço da página e validade
                  não são tocados. O resultado volta como rascunho para a sua revisão.
                </p>
              </div>
              <button
                type="button"
                disabled={aiBusy || busy || dirty || !aiConfigured || landing.status === "EXPIRED"}
                onClick={() => void improveWithClaude()}
                className="rounded-lg border border-nox-purple/50 bg-nox-purple/10 px-4 py-2 text-sm font-medium text-purple-100 hover:border-nox-purple disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aiBusy ? "Consultando o Claude…" : "Melhorar com Claude"}
              </button>
            </div>

            {aiConfigured && dirty && (
              <p className="mt-3 text-xs text-amber-200">
                Salve as alterações do rascunho antes de pedir a melhoria — o Claude parte do
                conteúdo já salvo.
              </p>
            )}

            {!aiConfigured && (
              <p className="mt-3 rounded-lg border border-nox-border bg-nox-surface p-3 text-xs leading-5 text-nox-muted">
                A melhoria com Claude não está configurada. Defina{" "}
                <code className="text-nox-cyan">ANTHROPIC_API_KEY</code> nas variáveis de ambiente
                da Vercel. O gerador automático continua funcionando normalmente.
              </p>
            )}

            {aiError && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {aiError}
              </p>
            )}

            {suggestion && (
              <div className="mt-4 rounded-lg border border-nox-purple/30 bg-nox-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-sm font-medium text-white">
                    Sugestão do Claude · {suggestion.changedFields.length}{" "}
                    {suggestion.changedFields.length === 1 ? "campo" : "campos"}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={applySuggestion}
                      className="rounded-lg bg-nox-purple px-3 py-2 text-sm font-medium text-white"
                    >
                      Aplicar ao rascunho
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestion(null)}
                      className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted hover:border-nox-cyan"
                    >
                      Descartar
                    </button>
                  </div>
                </div>

                {suggestion.droppedServices.length > 0 && (
                  <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">
                    {suggestion.droppedServices.length} serviço(s) sugerido(s) foram descartados
                    porque não estão confirmados na ficha. Só entram serviços já cadastrados.
                  </p>
                )}

                <p className="mt-3 text-xs text-nox-muted">
                  Aplicar substitui o rascunho atual. Nada é publicado: você ainda precisa salvar e
                  aprovar.
                </p>

                <ul className="mt-3 space-y-3">
                  {suggestion.changedFields.map((field) => (
                    <li key={field} className="rounded-lg border border-nox-border bg-nox-bg/50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-nox-cyan">
                        {AI_FIELD_LABELS[field] ?? field}
                      </p>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-nox-muted">Atual</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-nox-muted">
                            {describeFieldValue(
                              (landing.content as Record<string, unknown>)[field],
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-emerald-300">
                            Sugerido
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white">
                            {describeFieldValue(
                              (suggestion.content as unknown as Record<string, unknown>)[field],
                            )}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {lovableBriefing && (
            <div className="rounded-xl border border-nox-border bg-nox-bg/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-white">Criar no Lovable</h3>
                    <span className="rounded-full border border-nox-border px-2 py-0.5 text-xs text-nox-muted">
                      {lovablePrompt.length.toLocaleString("pt-BR")}/
                      {LOVABLE_PROMPT_MAX.toLocaleString("pt-BR")} caracteres
                    </span>
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-nox-muted">
                    Monta um prompt mestre com os dados verificados da ficha, os textos já revisados
                    e as fotos disponíveis, e abre o Lovable já construindo. O prompt proíbe
                    explicitamente inventar avaliação, preço, horário, prêmio ou serviço.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyLovablePrompt()}
                    className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan"
                  >
                    Copiar prompt
                  </button>
                  <button
                    type="button"
                    disabled={!lovablePrompt.trim()}
                    onClick={openInLovable}
                    className="rounded-lg bg-nox-purple px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Abrir no Lovable ↗
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nox-muted">
                <span>
                  {lovableBriefing.officialPhotoCount} foto(s) real(is) do estabelecimento
                </span>
                <span>{lovableBriefing.stockPhotoCount} ilustrativa(s), marcadas como tal</span>
                <span>
                  {lovableBriefing.htmlRefs.length
                    ? "Página da demonstração anexada como referência de layout"
                    : "Sem referência de layout: a prévia só é anexada por endereço HTTPS"}
                </span>
              </div>

              {dirty && (
                <p className="mt-3 text-xs text-amber-200">
                  O prompt usa a versão já salva. Salve as alterações para incluí-las.
                </p>
              )}

              <p className="mt-3 text-xs text-nox-muted">
                Se o Lovable abrir uma página de erro em vez do construtor, use{" "}
                <strong className="text-nox-cyan">Copiar prompt</strong> e cole direto no campo
                dele — o conteúdo é exatamente o mesmo.
              </p>

              <div className="mt-4 rounded-lg border border-nox-border bg-nox-surface p-4">
                <h4 className="text-sm font-medium text-white">Site já construído</h4>
                <p className="mt-1 text-xs leading-5 text-nox-muted">
                  Depois de publicar no Lovable, cole aqui o endereço. O NOX OS passa a servir esse
                  site pelo seu próprio domínio, com a mesma validade da demonstração — quando ela
                  expira, o link para de funcionar.
                </p>
                <div className="mt-3">
                  <UrlField
                    label="Endereço do site publicado"
                    hint="Obrigatoriamente HTTPS."
                    value={draft.builtSiteUrl}
                    onChange={(value) => updateDraft("builtSiteUrl", value)}
                  />
                </div>
                {builtSiteShareUrl && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={builtSiteShareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan"
                    >
                      Abrir site gerado pelo Lovable ↗
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyBuiltSiteLink()}
                      className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted hover:border-nox-cyan"
                    >
                      Copiar link
                    </button>
                    <code className="min-w-0 truncate text-xs text-nox-muted">
                      {builtSiteShareUrl}
                    </code>
                  </div>
                )}
                {dirty && draft.builtSiteUrl.trim() && (
                  <p className="mt-2 text-xs text-amber-200">
                    Salve para o link passar a funcionar.
                  </p>
                )}
              </div>

              <details className="mt-3 rounded-lg border border-nox-border bg-nox-surface">
                <summary className="cursor-pointer px-4 py-3 text-sm text-white marker:text-nox-cyan">
                  Ver e editar o prompt mestre
                </summary>
                <div className="border-t border-nox-border p-4">
                  <textarea
                    value={lovablePrompt}
                    maxLength={LOVABLE_PROMPT_MAX}
                    rows={16}
                    onChange={(event) => setLovablePromptOverride(event.target.value)}
                    className="block w-full resize-y rounded-lg border border-nox-border bg-nox-bg px-3 py-2 font-mono text-xs leading-5 text-white"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setLovablePromptOverride(null)}
                      className="rounded-lg border border-nox-border px-3 py-2 text-xs text-nox-muted hover:border-nox-cyan"
                    >
                      Restaurar prompt original
                    </button>
                    <span className="text-xs text-nox-muted">
                      Editou algo? A edição vale só para este envio.
                    </span>
                  </div>
                </div>
              </details>
            </div>
          )}

          <div className="space-y-3">
            <EditorSection
              title="1. Topo e identidade visual"
              description="Título, texto inicial, imagem principal, botão e cores."
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
                <div className="lg:col-span-2">
                  <UrlField
                    label="Imagem principal (opcional)"
                    hint="Foto oficial, autorizada ou ilustrativa, com URL iniciada por https://."
                    value={draft.heroImageUrl}
                    onChange={updateHeroImageUrl}
                  />
                  {draft.heroImageUrl.trim() && (
                    <p className="mt-2 text-xs text-nox-muted">
                      {draft.heroImageKind === "stock"
                        ? `Foto ilustrativa licenciada · ${draft.heroImageCredit ?? "crédito no rodapé"}`
                        : "Tratada como foto oficial do estabelecimento."}
                    </p>
                  )}
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
              title="4. Galeria"
              description={`${draft.galleryImages.length}/6 imagens cadastradas.`}
              defaultOpen={
                !draft.galleryTitle.trim() ||
                !draft.galleryIntro.trim() ||
                draft.galleryImages.some(
                  (galleryImage) =>
                    !galleryImage.url.trim() ||
                    !isSafeDemoImageUrl(galleryImage.url) ||
                    !galleryImage.alt.trim(),
                )
              }
            >
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-cyan-100">
                Use apenas imagens oficiais, próprias ou autorizadas. Se uma imagem for meramente
                ilustrativa, identifique-a como “Imagem ilustrativa” no texto alternativo. Todas as
                URLs devem começar com https://.
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da galeria"
                  value={draft.galleryTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("galleryTitle", value)}
                />
                <TextAreaField
                  label="Introdução da galeria"
                  value={draft.galleryIntro}
                  maxLength={600}
                  onChange={(value) => updateDraft("galleryIntro", value)}
                />
              </div>

              <div className="mt-4 space-y-3">
                {draft.galleryImages.length === 0 && (
                  <p className="rounded-lg border border-dashed border-nox-border p-4 text-sm text-nox-muted">
                    Nenhuma imagem cadastrada. A demonstração usará composições visuais
                    identificadas como ilustrativas até você adicionar fotos oficiais. Use
                    “Buscar fotos ilustrativas” abaixo, ou “Gerar novamente” para recriar a
                    demonstração já com fotos da categoria.
                  </p>
                )}
                {draft.galleryImages.map((galleryImage, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-nox-border bg-nox-bg/50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h4 className="text-sm font-medium text-white">Imagem {index + 1}</h4>
                      <div className="flex items-center gap-2">
                        {isSafeDemoImageUrl(galleryImage.url) && (
                          <a
                            href={galleryImage.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-nox-border px-2.5 py-1 text-xs text-nox-cyan hover:border-nox-cyan"
                          >
                            Conferir imagem ↗
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => removeGalleryImage(index)}
                          className="rounded-md border border-red-400/30 px-2.5 py-1 text-xs text-red-200 hover:border-red-400"
                          aria-label={`Remover imagem ${index + 1}`}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <UrlField
                        label="URL da imagem"
                        hint="Obrigatoriamente HTTPS."
                        value={galleryImage.url}
                        onChange={(value) => updateGalleryImage(index, "url", value)}
                        required
                      />
                      <TextField
                        label="Texto alternativo"
                        value={galleryImage.alt}
                        maxLength={180}
                        onChange={(value) => updateGalleryImage(index, "alt", value)}
                      />
                    </div>
                    <p className="mt-2 text-xs text-nox-muted">
                      Descreva o que aparece na imagem. Se ela não for oficial, inclua “Imagem
                      ilustrativa”.
                    </p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={draft.galleryImages.length >= 6}
                onClick={addGalleryImage}
                className="mt-3 rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
              >
                {draft.galleryImages.length >= 6
                  ? "Limite de 6 imagens"
                  : "+ Adicionar imagem"}
              </button>

              <StockPhotoPicker
                category={leadCategory}
                galleryFull={draft.galleryImages.length >= 6}
                onAddToGallery={addStockPhotoToGallery}
                onUseAsHero={useStockPhotoAsHero}
              />
            </EditorSection>

            <EditorSection
              title="5. Instagram do estabelecimento"
              description={
                instagramProfile
                  ? `Perfil encontrado na ficha: @${instagramProfile.username}`
                  : "Nenhum Instagram cadastrado na ficha deste lead."
              }
              defaultOpen={Boolean(instagramProfile) && !draft.instagramPosts.trim()}
            >
              <div className="rounded-lg border border-nox-cyan/20 bg-nox-cyan/5 p-3 text-xs leading-5 text-nox-muted">
                As publicações são exibidas pelo próprio Instagram, com o nome do perfil e link.
                Nenhuma imagem é copiada, então o estabelecimento continua dono do conteúdo e pode
                removê-lo quando quiser. Use apenas posts públicos.
              </div>

              {instagramProfile && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <a
                    href={instagramProfile.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-cyan hover:border-nox-cyan"
                  >
                    Abrir @{instagramProfile.username} ↗
                  </a>
                  <span className="text-xs text-nox-muted">
                    Abra o perfil, copie o endereço de até 3 publicações e cole abaixo.
                  </span>
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção"
                  value={draft.instagramTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("instagramTitle", value)}
                />
                <TextAreaField
                  label="Introdução da seção"
                  value={draft.instagramIntro}
                  maxLength={600}
                  onChange={(value) => updateDraft("instagramIntro", value)}
                />
                <div className="lg:col-span-2">
                  <TextAreaField
                    label="Endereços das publicações"
                    hint="Um por linha, no máximo 3. Formato instagram.com/p/... ou /reel/..."
                    value={draft.instagramPosts}
                    maxLength={6_000}
                    onChange={(value) => updateDraft("instagramPosts", value)}
                  />
                </div>
              </div>

              {invalidInstagramPosts.length > 0 && (
                <p role="alert" className="mt-2 text-xs text-red-300">
                  {invalidInstagramPosts.length} endereço(s) não são publicações do Instagram e vão
                  impedir o salvamento. Use o link de um post ou reel público.
                </p>
              )}
              {instagramPostCount > 3 && (
                <p role="alert" className="mt-2 text-xs text-red-300">
                  Use no máximo 3 publicações.
                </p>
              )}
            </EditorSection>

            <EditorSection
              title="6. Como funciona"
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
              title="7. Perguntas frequentes"
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
              title="8. Contato"
              description="Oriente o visitante a confirmar os detalhes com o estabelecimento."
              defaultOpen={!draft.contactTitle.trim() || !draft.contactText.trim()}
            >
              <div className="mb-4 rounded-lg border border-nox-cyan/20 bg-nox-cyan/5 p-3 text-xs leading-5 text-nox-muted">
                Telefone, endereço, redes sociais e mapa são copiados da ficha quando a demonstração
                é gerada. Para atualizar esses dados, corrija a ficha e gere novamente; uma página
                aprovada não muda sozinha.
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Título da seção de contato"
                  value={draft.contactTitle}
                  maxLength={120}
                  onChange={(value) => updateDraft("contactTitle", value)}
                />
                <TextAreaField
                  label="Texto de contato"
                  hint="Não inclua telefone, horário ou canal que não esteja confirmado."
                  value={draft.contactText}
                  maxLength={600}
                  onChange={(value) => updateDraft("contactText", value)}
                />
              </div>
            </EditorSection>

            <EditorSection
              title="9. Chamada final"
              description="Fechamento final da página."
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
            <button
              type="button"
              disabled={busy}
              onClick={confirmRegenerate}
              className="rounded-lg border border-nox-border px-4 py-2 text-sm text-nox-muted hover:border-nox-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              Gerar novamente
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

function UrlField({
  label,
  hint,
  value,
  required = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const invalid =
    (required || value.trim().length > 0) && !isSafeDemoImageUrl(value);

  return (
    <label className="text-sm text-nox-muted">
      {label}
      {hint && <span className="ml-1 text-xs">· {hint}</span>}
      <input
        type="url"
        inputMode="url"
        value={value}
        maxLength={2_000}
        placeholder="https://exemplo.com/imagem.jpg"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 block w-full rounded-lg border bg-nox-bg px-3 py-2 text-white ${
          invalid ? "border-red-400/70" : "border-nox-border"
        }`}
      />
      {invalid && (
        <span className="mt-1 block text-xs text-red-300">
          {value.trim()
            ? "Use uma URL completa iniciada por https://."
            : "Informe a URL HTTPS da imagem ou remova este item."}
        </span>
      )}
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
    heroImageUrl: content.heroImageUrl ?? "",
    heroImageKind: content.heroImageKind ?? "official",
    heroImageCredit: content.heroImageCredit ?? null,
    heroImageCreditUrl: content.heroImageCreditUrl ?? "",
    builtSiteUrl: content.builtSiteUrl ?? "",
    aboutTitle: content.aboutTitle ?? "Sobre",
    about: content.about ?? "",
    factsTitle: content.factsTitle ?? "Destaques",
    benefits: Array.isArray(content.benefits) ? content.benefits.join("\n") : "",
    servicesTitle: content.servicesTitle ?? "Serviços",
    servicesIntro: content.servicesIntro ?? "",
    services: Array.isArray(content.services) ? content.services.join("\n") : "",
    galleryTitle: content.galleryTitle ?? DEFAULT_GALLERY_TITLE,
    galleryIntro: content.galleryIntro ?? DEFAULT_GALLERY_INTRO,
    galleryImages: Array.isArray(content.galleryImages)
      ? content.galleryImages.slice(0, 6).map((galleryImage) => ({
          url: galleryImage.url ?? "",
          alt: galleryImage.alt ?? "",
          kind: galleryImage.kind ?? "official",
          credit: galleryImage.credit ?? null,
          creditUrl: galleryImage.creditUrl ?? "",
        }))
      : [],
    instagramTitle: content.instagramTitle ?? "No Instagram",
    instagramIntro: content.instagramIntro ?? "",
    instagramPosts: Array.isArray(content.instagramPosts)
      ? content.instagramPosts.join("\n")
      : "",
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
    contactTitle: content.contactTitle ?? DEFAULT_CONTACT_TITLE,
    contactText: content.contactText ?? DEFAULT_CONTACT_TEXT,
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
    heroImageUrl: draft.heroImageUrl.trim(),
    heroImageKind: draft.heroImageKind,
    heroImageCredit: draft.heroImageCredit,
    heroImageCreditUrl: draft.heroImageCreditUrl,
    builtSiteUrl: draft.builtSiteUrl.trim(),
    aboutTitle: draft.aboutTitle.trim(),
    about: draft.about.trim(),
    factsTitle: draft.factsTitle.trim(),
    benefits: toLines(draft.benefits),
    servicesTitle: draft.servicesTitle.trim(),
    servicesIntro: draft.servicesIntro.trim(),
    services: toLines(draft.services),
    galleryTitle: draft.galleryTitle.trim(),
    galleryIntro: draft.galleryIntro.trim(),
    galleryImages: draft.galleryImages.map((galleryImage) => ({
      url: galleryImage.url.trim(),
      alt: galleryImage.alt.trim(),
      kind: galleryImage.kind,
      credit: galleryImage.credit,
      creditUrl: galleryImage.creditUrl,
    })),
    instagramTitle: draft.instagramTitle.trim(),
    instagramIntro: draft.instagramIntro.trim(),
    instagramPosts: toLines(draft.instagramPosts),
    processTitle: draft.processTitle.trim(),
    processIntro: draft.processIntro.trim(),
    processSteps: toLines(draft.processSteps),
    faqTitle: draft.faqTitle.trim(),
    faqs: draft.faqs.map((faq) => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
    })),
    contactTitle: draft.contactTitle.trim(),
    contactText: draft.contactText.trim(),
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
  if (root === "galleryImages") {
    const position = typeof path[1] === "number" ? path[1] + 1 : null;
    const part = path[2] === "url" ? "a URL" : "o texto alternativo";
    return position ? `${part} da imagem ${position}` : "as imagens da galeria";
  }
  if (root === "instagramPosts") return "os endereços das publicações do Instagram";
  if (root === "processSteps") return "as etapas de como funciona";
  if (root === "benefits") return "as informações disponíveis";
  if (root === "services") return "os serviços";

  const labels: Record<string, string> = {
    headline: "o título principal",
    subheadline: "o subtítulo",
    heroImageUrl: "a URL da imagem principal",
    aboutTitle: "o título da seção Sobre",
    about: "o texto Sobre a empresa",
    factsTitle: "o título das informações",
    servicesTitle: "o título dos serviços",
    servicesIntro: "a introdução dos serviços",
    galleryTitle: "o título da galeria",
    galleryIntro: "a introdução da galeria",
    processTitle: "o título de Como funciona",
    processIntro: "a introdução de Como funciona",
    faqTitle: "o título das perguntas frequentes",
    contactTitle: "o título da seção de contato",
    contactText: "o texto da seção de contato",
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
