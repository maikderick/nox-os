"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Sparkles,
  TimerReset,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type SiteDto = {
  id: string;
  slug: string;
  status: "DRAFT" | "APPROVED" | "EXPIRED";
  expiresAt: string;
  approvedAt: string | null;
  updatedAt: string;
  previewUrl: string;
  content: { headline: string; primaryColor: string; accentColor: string; ctaLabel: string; services: string[] };
};

type Props = {
  projectId: string;
  initialSite: SiteDto | null;
  canWrite: boolean;
  leadId: string | null;
  aiConfigured: boolean;
};

/** What the operator sees while the page is being assembled. */
const STAGES = [
  "Lendo o briefing confirmado",
  "Aplicando as regras do setor",
  "Buscando fotos ilustrativas licenciadas",
  "Montando as seções e a direção visual",
  "Publicando a prévia",
];

const PERMANENT_THRESHOLD_DAYS = 365;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function SitePanel({ projectId, initialSite, canWrite, leadId, aiConfigured }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [site, setSite] = useState<SiteDto | null>(initialSite);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoStarted = useRef(false);

  const generate = useCallback(async () => {
    setGenerating(true);
    setStage(0);
    setError(null);
    // The stages advance on a timer while the single request runs; the last
    // one only completes when the server answers.
    const ticker = window.setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 900);
    try {
      const response = await fetch(`/api/projects/${projectId}/site`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as { site?: SiteDto; error?: unknown } | null;
      if (!response.ok || !payload?.site) {
        const message =
          typeof payload?.error === "string" ? payload.error : "Não foi possível gerar o site. Tente de novo.";
        throw new Error(message);
      }
      setStage(STAGES.length);
      setSite(payload.site);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o site.");
    } finally {
      window.clearInterval(ticker);
      setGenerating(false);
    }
  }, [projectId, router]);

  // Arriving from the wizard with ?gerar=1 starts the generation once.
  useEffect(() => {
    if (autoStarted.current || !canWrite || site || params.get("gerar") !== "1") return;
    autoStarted.current = true;
    void generate();
  }, [canWrite, generate, params, site]);

  async function act(action: "tornar_permanente" | "renovar" | "encerrar") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/site`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as { site?: SiteDto; error?: unknown } | null;
      if (!response.ok || !payload?.site) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "A ação não pôde ser concluída.");
      }
      setSite(payload.site);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A ação não pôde ser concluída.");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!site) return;
    try {
      await navigator.clipboard.writeText(site.previewUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const expired = site ? site.status === "EXPIRED" || daysUntil(site.expiresAt) <= 0 : false;
  const permanent = site ? !expired && daysUntil(site.expiresAt) > PERMANENT_THRESHOLD_DAYS : false;
  const online = Boolean(site) && !expired;

  return (
    <section className="nox-card overflow-hidden" aria-label="Site do cliente">
      {generating ? (
        <div className="p-6 sm:p-8" aria-busy="true" aria-live="polite">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-nox-cyan/10 text-nox-cyan">
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Gerando o site</h2>
                <span className="font-mono text-sm text-nox-cyan">
                  {Math.round((Math.min(stage, STAGES.length) / STAGES.length) * 100)}%
                </span>
              </div>
              <p className="mt-1 text-sm text-nox-muted">Estruturando a página a partir do briefing confirmado.</p>
              <div
                className="mt-4 h-1.5 overflow-hidden rounded-full bg-nox-panel"
                role="progressbar"
                aria-label="Progresso da geração"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((Math.min(stage, STAGES.length) / STAGES.length) * 100)}
              >
                <div
                  className="h-full rounded-full bg-linear-to-r from-nox-purple to-nox-cyan transition-all duration-700"
                  style={{ width: `${Math.max(8, (Math.min(stage, STAGES.length) / STAGES.length) * 100)}%` }}
                />
              </div>
              <ol className="mt-5 space-y-2 font-mono text-xs">
                {STAGES.map((label, index) => {
                  const done = index < stage;
                  const active = index === stage;
                  return (
                    <li key={label} className={cn("flex items-center gap-2", done ? "text-emerald-300" : active ? "text-white" : "text-nox-muted/60")}>
                      {done ? <Check size={13} aria-hidden="true" /> : active ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <span className="inline-block h-3 w-3 rounded-full border border-nox-border" />}
                      {label}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      ) : site && online ? (
        <div>
          <div
            className="relative h-28 overflow-hidden"
            style={{ backgroundImage: `linear-gradient(135deg, ${site.content.primaryColor}, ${site.content.accentColor})` }}
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-black/35" />
            <div className="absolute inset-x-6 bottom-4 flex items-end justify-between gap-4">
              <p className="truncate text-2xl font-semibold tracking-tight text-white">{site.content.headline}</p>
              <span className="rounded-full border border-white/25 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur">
                {permanent ? "Permanente" : "Prévia"}
              </span>
            </div>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="nox-eyebrow flex items-center gap-1.5">
                  <Globe size={12} aria-hidden="true" /> Site no ar
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  {permanent ? "Site permanente" : `Prévia válida por ${Math.max(daysUntil(site.expiresAt), 0)} dias`}
                </h2>
                <p className="mt-1 text-sm text-nox-muted">
                  {permanent
                    ? `Aprovado em ${formatDate(site.approvedAt ?? site.updatedAt)}. Fica no ar até você encerrar.`
                    : `Expira em ${formatDate(site.expiresAt)}. Se o cliente aprovar, torne permanente.`}
                  {aiConfigured ? " Texto refinado com IA." : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={site.previewUrl} target="_blank" rel="noreferrer" className="nox-btn-primary">
                  <ExternalLink size={15} aria-hidden="true" /> Abrir site
                </a>
                <button type="button" onClick={() => void copyLink()} className="nox-btn-secondary">
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  {copied ? "Copiado" : "Copiar link"}
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-nox-border bg-nox-bg px-4 py-3 font-mono text-xs text-nox-muted">
              <span className="text-white">{site.previewUrl}</span>
            </div>

            {canWrite ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-nox-border pt-5">
                {!permanent ? (
                  <button type="button" disabled={busy !== null} onClick={() => void act("tornar_permanente")} className="nox-btn-primary">
                    {busy === "tornar_permanente" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
                    Cliente aprovou: tornar permanente
                  </button>
                ) : null}
                {!permanent ? (
                  <button type="button" disabled={busy !== null} onClick={() => void act("renovar")} className="nox-btn-secondary">
                    <TimerReset size={15} aria-hidden="true" /> Renovar por 14 dias
                  </button>
                ) : null}
                <button type="button" disabled={busy !== null || generating} onClick={() => void generate()} className="nox-btn-secondary">
                  <RefreshCw size={15} aria-hidden="true" /> Gerar de novo
                </button>
                {leadId ? (
                  <Link href={`/leads/${leadId}#whatsapp`} className="nox-btn-secondary">
                    <MessageCircle size={15} aria-hidden="true" /> Enviar ao cliente
                  </Link>
                ) : null}
                <button type="button" disabled={busy !== null} onClick={() => void act("encerrar")} className="nox-btn-ghost text-red-200 hover:bg-red-400/10">
                  <XCircle size={15} aria-hidden="true" /> Encerrar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-nox-cyan/10 text-nox-cyan">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white">
                {site ? "A prévia expirou" : "Gerar o site"}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-nox-muted">
                {site
                  ? "O link antigo saiu do ar. Gere de novo a partir do briefing atual; o endereço continua o mesmo."
                  : "A página é montada só com o que foi confirmado no briefing: serviços, contato, endereço e posicionamento. Fica no ar por 14 dias como prévia."}
              </p>
              {canWrite ? (
                <button type="button" onClick={() => void generate()} className="nox-btn-primary mt-5 px-6">
                  <Sparkles size={16} aria-hidden="true" /> {site ? "Gerar de novo" : aiConfigured ? "Gerar site com IA" : "Gerar site"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="mx-6 mb-6 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200 sm:mx-8 sm:mb-8">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      ) : null}
    </section>
  );
}
