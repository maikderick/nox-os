"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  demoLandingContentSchema,
  type DemoLandingContent,
} from "@/lib/demo-landing-schema";

type DemoLanding = {
  id: string;
  leadId?: string;
  slug: string;
  status: "DRAFT" | "APPROVED" | "EXPIRED";
  expiresAt: string;
  content: DemoLandingContent;
  publicUrl?: string;
  previewUrl?: string;
  approvedAt?: string | null;
};

type Draft = Omit<DemoLandingContent, "benefits" | "services"> & {
  benefits: string;
  services: string;
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
  about: "",
  benefits: "",
  services: "",
  ctaLabel: "Fale conosco",
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
      setError(`Revise o conteúdo: ${parsedContent.error.issues[0]?.message ?? "campo inválido"}.`);
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

          <div className="grid gap-4 lg:grid-cols-2">
            <TextField
              label="Título principal"
              value={draft.headline}
              maxLength={120}
              onChange={(value) => updateDraft("headline", value)}
            />
            <TextField
              label="Chamada do botão"
              value={draft.ctaLabel}
              maxLength={60}
              onChange={(value) => updateDraft("ctaLabel", value)}
            />
            <TextAreaField
              label="Subtítulo"
              value={draft.subheadline}
              maxLength={320}
              onChange={(value) => updateDraft("subheadline", value)}
            />
            <TextAreaField
              label="Sobre a empresa"
              value={draft.about}
              maxLength={1200}
              onChange={(value) => updateDraft("about", value)}
            />
            <TextAreaField
              label="Benefícios"
              hint="Um benefício por linha."
              value={draft.benefits}
              maxLength={700}
              onChange={(value) => updateDraft("benefits", value)}
            />
            <TextAreaField
              label="Serviços confirmados"
              hint="Um por linha. Deixe vazio se ainda não foram confirmados."
              value={draft.services}
              maxLength={700}
              onChange={(value) => updateDraft("services", value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
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
            <label className="text-sm text-nox-muted">
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

function toDraft(content: DemoLandingContent): Draft {
  return {
    headline: content.headline ?? "",
    subheadline: content.subheadline ?? "",
    about: content.about ?? "",
    benefits: Array.isArray(content.benefits) ? content.benefits.join("\n") : "",
    services: Array.isArray(content.services) ? content.services.join("\n") : "",
    ctaLabel: content.ctaLabel ?? "Fale conosco",
    primaryColor: validHex(content.primaryColor) ? content.primaryColor : "#111827",
    accentColor: validHex(content.accentColor) ? content.accentColor : "#22d3ee",
  };
}

function toContent(draft: Draft): DemoLandingContent {
  return {
    ...draft,
    headline: draft.headline.trim(),
    subheadline: draft.subheadline.trim(),
    about: draft.about.trim(),
    benefits: toLines(draft.benefits),
    services: toLines(draft.services),
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
