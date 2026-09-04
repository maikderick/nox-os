"use client";

import { Check, Copy, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";

function subscribeToOrigin() {
  return () => undefined;
}

function getBrowserOrigin() {
  return window.location.origin;
}

function getServerOrigin() {
  return "";
}

export function GenerationControls({
  projectId,
  canGenerate,
  canPrepare,
  needsProvisioning,
  canRunQueue,
  isProcessing,
  publicHref,
}: {
  projectId: string;
  canGenerate: boolean;
  canPrepare: boolean;
  needsProvisioning: boolean;
  canRunQueue: boolean;
  isProcessing: boolean;
  publicHref: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"generate" | "queue" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const publicUrl = publicHref
    ? origin
      ? new URL(publicHref, origin).href
      : publicHref
    : "";

  useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setInterval(() => startTransition(() => router.refresh()), 4_000);
    return () => window.clearInterval(timer);
  }, [isProcessing, router]);

  async function read(response: Response) {
    return (await response.json().catch(() => null)) as
      | { error?: unknown; claimed?: number; outcomes?: Record<string, number> }
      | null;
  }

  async function runQueue() {
    setRunning("queue");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/jobs/run", { method: "POST" });
      const payload = await read(response);
      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "A fila não pôde ser processada.");
        return;
      }
      setMessage(`Fila processada: ${payload?.claimed ?? 0} job(s) adquirido(s).`);
      startTransition(() => router.refresh());
    } catch {
      setError("A fila não pôde ser processada.");
    } finally {
      setRunning(null);
    }
  }

  async function generate() {
    setRunning("generate");
    setError(null);
    setMessage(null);
    try {
      if (needsProvisioning) {
        if (!canPrepare) {
          setError("Ative GitHub e Vercel para preparar o projeto antes da geração.");
          return;
        }

        const steps = ["repository", "content", "hosting"] as const;
        for (const step of steps) {
          const label =
            step === "repository" ? "repositório" : step === "content" ? "conteúdo" : "hospedagem";
          setMessage(`Preparando ${label}...`);
          const provision = await fetch(`/api/projects/${projectId}/provision/${step}`, {
            method: "POST",
          });
          const provisionPayload = await read(provision);
          if (!provision.ok) {
            setError(
              typeof provisionPayload?.error === "string"
                ? provisionPayload.error
                : "A preparação automática não pôde ser concluída.",
            );
            return;
          }
        }
      }

      setMessage("Registrando a geração...");
      const response = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const payload = await read(response);
      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "A geração não pôde ser solicitada.");
        return;
      }
      setMessage("Geração registrada. A página será atualizada automaticamente.");
      if (canRunQueue) {
        await fetch("/api/jobs/run", { method: "POST" });
      }
      startTransition(() => router.refresh());
    } catch {
      setError("A geração não pôde ser solicitada.");
    } finally {
      setRunning(null);
    }
  }

  async function copyPublicUrl() {
    if (!publicUrl) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o endereço acima e copie.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate || (needsProvisioning && !canPrepare) || running !== null || pending || isProcessing}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-nox-bg transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running === "generate" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {isProcessing
            ? "Geração em andamento"
            : needsProvisioning
              ? "Preparar e gerar site"
              : "Gerar site"}
        </button>
        {canRunQueue ? (
          <button
            type="button"
            onClick={runQueue}
            disabled={running !== null || pending}
            className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm text-white transition hover:border-nox-cyan disabled:opacity-50"
          >
            {running === "queue" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Processar fila agora
          </button>
        ) : null}
      </div>
      {publicHref ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4">
          <p className="text-sm font-semibold text-emerald-200">Site pronto para apresentar</p>
          <p className="mt-1 text-xs leading-5 text-nox-muted">
            Este endereço abre sem login e sempre mostra a versão atual do briefing.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Endereço público do site"
              readOnly
              value={publicUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-nox-border bg-nox-bg px-3 py-2.5 text-sm text-white outline-none focus:border-nox-cyan"
            />
            <button
              type="button"
              onClick={copyPublicUrl}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-nox-border px-4 py-2.5 text-sm font-medium text-white transition hover:border-nox-cyan"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copiado" : "Copiar link"}
            </button>
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-nox-cyan px-4 py-2.5 text-sm font-semibold text-nox-bg transition hover:bg-cyan-200"
            >
              Abrir site do cliente <ExternalLink size={15} />
            </a>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
