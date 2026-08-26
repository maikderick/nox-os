"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

type StepId = "repository" | "content" | "hosting" | "reconcile-preview";

type ProvisioningView = {
  status: string;
  lastStep: string | null;
  commitSha: string | null;
  contentSha256: string | null;
  previewUrl: string | null;
  previewCheckedAt: string | null;
  repositoryUrl: string | null;
  repositoryName: string | null;
  hostingName: string | null;
  hostingUrl: string | null;
};

const STEPS: Array<{ id: StepId; title: string; description: string }> = [
  {
    id: "repository",
    title: "1 · Criar o repositório",
    description:
      "Cria o repositório privado a partir do template e exige o check verify no branch padrão.",
  },
  {
    id: "content",
    title: "2 · Publicar o conteúdo",
    description:
      "Commita o snapshot confirmado e o manifesto. Conteúdo idêntico não gera um segundo commit.",
  },
  {
    id: "hosting",
    title: "3 · Criar o projeto de hospedagem",
    description:
      "Confere se a instalação enxerga o repositório antes de criar o projeto ligado a ele.",
  },
  {
    id: "reconcile-preview",
    title: "4 · Reconciliar a prévia",
    description: "Pergunta à plataforma o que ela construiu para o commit publicado.",
  },
];

/** Which steps the recorded status implies are already done. */
function completedFor(status: string): Set<StepId> {
  const ladder: StepId[] = ["repository", "content", "hosting", "reconcile-preview"];
  const reached: Record<string, number> = {
    REPOSITORIO_PRONTO: 1,
    CONTEUDO_PRONTO: 2,
    HOSPEDAGEM_PRONTA: 3,
    PREVIA_RECONCILIADA: 4,
  };
  return new Set(ladder.slice(0, reached[status] ?? 0));
}

export function ProvisioningSteps({
  projectId,
  canRun,
  state,
}: {
  projectId: string;
  canRun: boolean;
  state: ProvisioningView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<StepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = completedFor(state.status);

  async function run(step: StepId) {
    setRunning(step);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/provision/${step}`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; alreadyDone?: boolean; pending?: boolean }
        | null;

      if (!response.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "A etapa não pôde ser concluída.",
        );
        return;
      }

      if (payload?.alreadyDone) setNotice("Esta etapa já estava concluída; nada foi alterado.");
      else if (payload?.pending)
        setNotice("A plataforma ainda não terminou de construir. Reconcilie de novo em instantes.");

      startTransition(() => router.refresh());
    } catch {
      setError("A etapa não pôde ser concluída.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-nox-border bg-nox-panel p-3 text-sm text-nox-muted">
          {notice}
        </p>
      ) : null}

      {STEPS.map((step) => {
        const complete = done.has(step.id);
        return (
          <section
            key={step.id}
            className="rounded-2xl border border-nox-border bg-nox-surface p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl">
                <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                  {complete ? (
                    <Check size={16} className="text-emerald-300" aria-hidden="true" />
                  ) : null}
                  {step.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-nox-muted">{step.description}</p>
                {step.id === "repository" && state.repositoryName ? (
                  <p className="mt-2 text-xs text-nox-muted">{state.repositoryName}</p>
                ) : null}
                {step.id === "content" && state.commitSha ? (
                  <p className="mt-2 text-xs text-nox-muted">
                    commit <code className="text-nox-cyan">{state.commitSha.slice(0, 12)}</code>
                  </p>
                ) : null}
                {step.id === "hosting" && state.hostingName ? (
                  <p className="mt-2 text-xs text-nox-muted">{state.hostingName}</p>
                ) : null}
                {step.id === "reconcile-preview" && state.previewCheckedAt ? (
                  <p className="mt-2 text-xs text-nox-muted">
                    Consultado em {new Date(state.previewCheckedAt).toLocaleString("pt-BR")}
                  </p>
                ) : null}
              </div>

              {canRun ? (
                <button
                  type="button"
                  onClick={() => run(step.id)}
                  disabled={running !== null || pending}
                  className="inline-flex items-center gap-2 rounded-xl border border-nox-border px-4 py-2 text-sm text-white transition hover:border-nox-cyan disabled:opacity-50"
                >
                  {running === step.id ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {complete ? "Executar de novo" : "Executar"}
                </button>
              ) : null}
            </div>
          </section>
        );
      })}

      {!canRun ? (
        <p className="text-xs text-nox-muted">
          Executar uma etapa exige <code className="text-nox-cyan">provisioning:run</code>. Você
          pode acompanhar o andamento.
        </p>
      ) : null}
    </div>
  );
}
