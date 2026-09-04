"use client";

/**
 * Editing the briefing of a project that already exists.
 *
 * Everything on screen is {@link BriefWizard}; what lives here is the request
 * that appends a new immutable version and what to say when the state machine
 * refuses it.
 */

import {
  BriefWizard,
  describeApiError,
  type BriefWizardResult,
  type BriefWizardSubmission,
} from "@/components/projetos/brief-wizard";
import type { BriefDraft } from "@/lib/site-factory/brief-draft";
import type { BriefCapabilities } from "@/lib/site-factory/brief-schema";
import { isSiteProjectState, SITE_PROJECT_STATE_LABELS } from "@/lib/site-factory/states";

export function BriefEditor({
  projectId,
  initialDraft,
}: {
  projectId: string;
  initialDraft: BriefDraft;
}) {
  return (
    <BriefWizard
      mode="edit"
      initialDraft={initialDraft}
      onSubmit={(submission) => saveBrief(projectId, submission)}
    />
  );
}

/**
 * What a refused save means, said in terms of where the project actually is.
 *
 * `SiteProjectTransitionError` travels as `{ code, from, to }`, so the state
 * the machine refused from is on the wire. Two of them are a machine holding
 * the project and are worth waiting out; the rest are a cycle that has moved
 * on, and waiting will not help.
 */
function refusalMessage(payload: { error?: unknown; from?: unknown } | null): string {
  const from = payload?.from;
  if (isSiteProjectState(from)) {
    if (from === "GERANDO") {
      return "Este projeto está em construção pelo agente; aguarde ou cancele antes de editar.";
    }
    if (from === "PUBLICANDO") {
      return "Este projeto está sendo publicado; aguarde a publicação terminar para editar o briefing.";
    }
    return `O projeto está em “${SITE_PROJECT_STATE_LABELS[from]}”, e a partir daí uma versão nova do briefing não é aceita. Volte à página do projeto para reabrir o ciclo.`;
  }
  return typeof payload?.error === "string"
    ? payload.error
    : "O projeto mudou de estado enquanto você editava. Recarregue a página do projeto e tente de novo.";
}

async function saveBrief(
  projectId: string,
  { brief }: BriefWizardSubmission,
): Promise<BriefWizardResult> {
  const response = await fetch(`/api/projects/${projectId}/brief`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(brief),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; capabilities?: BriefCapabilities; code?: string; from?: string }
    | null;

  if (!response.ok) {
    // 409 is the state machine refusing. It says which state it refused from,
    // and that is the whole of what the operator needs — "the agent is
    // building this" is true for one of them and a lie for the rest.
    if (response.status === 409) return { ok: false, error: refusalMessage(payload) };
    // Anything else is the schema refusing a field, reported the same way the
    // creation flow reports it — by field, not as a generic failure.
    return { ok: false, error: describeApiError(payload?.error) };
  }

  return {
    ok: true,
    destination: `/projetos/${projectId}`,
    capabilities: payload?.capabilities ?? null,
  };
}
