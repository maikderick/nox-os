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
    | { error?: unknown; capabilities?: BriefCapabilities }
    | null;

  if (!response.ok) {
    // 409 is the state machine refusing, and there is only one reason it can:
    // the agent is building this project right now, so a new brief version
    // would move the ground under a run already in flight.
    if (response.status === 409) {
      return {
        ok: false,
        error: "Este projeto está em construção pelo agente; aguarde ou cancele antes de editar.",
      };
    }
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
