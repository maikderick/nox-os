"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type { SiteProjectState } from "@/lib/site-factory/states";

/**
 * A human transition, as one button.
 *
 * The transition endpoint is `PATCH /api/projects/:id`, which resolves the
 * actor through the DAL and asks the state machine which permission the move
 * requires — so this component never decides anything: it names the target
 * state and reports whatever the domain answers.
 *
 * Exported so any page offering a human transition reuses this one component
 * instead of hand-rolling the same fetch/spinner/error dance again.
 */
export function TransitionButton({
  projectId,
  targetStatus,
  label,
  busyLabel,
  failure,
  icon,
  className,
  description,
}: {
  projectId: string;
  targetStatus: SiteProjectState;
  label: string;
  busyLabel: string;
  failure: string;
  icon: ReactNode;
  className: string;
  /** Optional caption rendered under the button, when the label alone isn't enough. */
  description?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : failure);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(failure);
    } finally {
      setRunning(false);
    }
  }

  const busy = running || pending;

  return (
    <div className="space-y-2">
      <button type="button" onClick={request} disabled={busy} className={className}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
        {busy ? busyLabel : label}
      </button>
      {description && !error ? <p className="text-xs text-nox-muted">{description}</p> : null}
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}

/**
 * The deterministic release.
 *
 * The renderer computes the whole site from the confirmed brief, so this asks
 * for `BRIEFING_PRONTO -> PREVIA_PRONTA` and nothing else: no provisioning, no
 * queue, no credit, nothing external that could be down. Building the real
 * repository with the agent is a separate, later step.
 */
export function GenerateSiteButton({
  projectId,
  size = "large",
}: {
  projectId: string;
  /** `large` for a page's primary action, `small` beside other controls. */
  size?: "large" | "small";
}) {
  return (
    <TransitionButton
      projectId={projectId}
      targetStatus="PREVIA_PRONTA"
      label="Gerar site"
      busyLabel="Gerando site"
      failure="O site não pôde ser gerado agora."
      icon={<Sparkles size={16} aria-hidden="true" />}
      className={size === "large" ? "nox-btn-primary px-6 py-3 text-base" : "nox-btn-primary"}
    />
  );
}

/** `PREVIA_PRONTA -> EM_REVISAO`: the site exists, someone has to look at it. */
export function SendToReviewButton({ projectId }: { projectId: string }) {
  return (
    <TransitionButton
      projectId={projectId}
      targetStatus="EM_REVISAO"
      label="Enviar para revisão"
      busyLabel="Enviando"
      failure="O projeto não pôde ser enviado para revisão agora."
      icon={<Send size={16} aria-hidden="true" />}
      className="nox-btn-secondary"
    />
  );
}
