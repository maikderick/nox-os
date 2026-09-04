"use client";

import { Loader2, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Decision = "EFEITO_CONFIRMADO" | "SEM_EFEITO_CONFIRMADO" | "DESCARTAR";

async function responseMessage(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : null;
}

export function QueueRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/jobs/run", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { claimed?: number; error?: unknown }
        | null;
      setNotice(
        response.ok
          ? `${body?.claimed ?? 0} job(s) processado(s) neste ciclo.`
          : typeof body?.error === "string"
            ? body.error
            : "A fila não pôde ser processada.",
      );
      if (response.ok) startTransition(() => router.refresh());
    } catch {
      setNotice("A fila não pôde ser processada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={busy || pending} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-nox-bg hover:bg-cyan-100 disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        Processar fila
      </button>
      {notice ? <p className="text-sm text-nox-muted" role="status">{notice}</p> : null}
    </div>
  );
}

export function QueueJobActions({ jobId, status, kind }: { jobId: string; status: string; kind: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerRunId, setProviderRunId] = useState("");

  async function reprocess() {
    setBusy("reprocess");
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/reprocess`, { method: "POST" });
      if (!response.ok) setError((await responseMessage(response)) ?? "O job não pôde ser reprocessado.");
      else startTransition(() => router.refresh());
    } catch {
      setError("O job não pôde ser reprocessado.");
    } finally {
      setBusy(null);
    }
  }

  async function resolve(decision: Decision) {
    const warnings: Record<Decision, string> = {
      EFEITO_CONFIRMADO: "Confirmar que a execução externa ocorreu e consumir a reserva?",
      SEM_EFEITO_CONFIRMADO: "Confirmar ausência de efeito, liberar a reserva e criar uma nova execução?",
      DESCARTAR: "Descartar o resultado ambíguo e encerrar a geração? A reserva será consumida de forma conservadora.",
    };
    if (!window.confirm(warnings[decision])) return;
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/conciliation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(providerRunId ? { providerRunId } : {}) }),
      });
      if (!response.ok) setError((await responseMessage(response)) ?? "A conciliação não pôde ser resolvida.");
      else startTransition(() => router.refresh());
    } catch {
      setError("A conciliação não pôde ser resolvida.");
    } finally {
      setBusy(null);
    }
  }

  if (status === "CARTA_MORTA") {
    return (
      <div className="mt-4">
        <button type="button" onClick={reprocess} disabled={busy !== null || pending} className="inline-flex items-center gap-2 rounded-lg border border-nox-border px-3 py-2 text-xs text-white hover:border-nox-cyan disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          Reprocessar carta morta
        </button>
        {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
      </div>
    );
  }

  if (status !== "CONCILIACAO") return null;

  return (
    <div className="mt-4 space-y-3 border-t border-nox-border pt-4">
      {kind === "generation.start" ? (
        <label className="block text-xs text-nox-muted">
          ID da execução externa, se o efeito foi confirmado
          <input value={providerRunId} onChange={(event) => setProviderRunId(event.target.value)} className="mt-1 block w-full max-w-sm rounded-lg border border-nox-border bg-nox-bg px-3 py-2 text-sm text-white outline-none focus:border-nox-cyan" autoComplete="off" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {kind === "generation.start" ? <button type="button" onClick={() => resolve("EFEITO_CONFIRMADO")} disabled={!providerRunId || busy !== null || pending} className="rounded-lg border border-emerald-400/40 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50">Efeito confirmado</button> : null}
        <button type="button" onClick={() => resolve("SEM_EFEITO_CONFIRMADO")} disabled={busy !== null || pending} className="rounded-lg border border-nox-border px-3 py-2 text-xs text-white disabled:opacity-50">Sem efeito confirmado</button>
        <button type="button" onClick={() => resolve("DESCARTAR")} disabled={busy !== null || pending} className="rounded-lg border border-red-400/40 px-3 py-2 text-xs text-red-200 disabled:opacity-50">Descartar</button>
      </div>
      {busy ? <p className="flex items-center gap-2 text-xs text-nox-muted"><Loader2 size={13} className="animate-spin" />Aplicando decisão…</p> : null}
      {error ? <p className="text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
