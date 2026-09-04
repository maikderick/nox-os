"use client";

/**
 * Creating a project, which is one briefing away from editing one.
 *
 * Everything on screen belongs to {@link BriefWizard}; what lives here is the
 * only thing creating does differently — the request that makes a client, a
 * project and the first immutable brief version in a single transaction, and
 * the place the operator lands afterwards.
 */

import {
  BriefWizard,
  describeApiError,
  type BriefWizardResult,
  type BriefWizardSubmission,
  type StudioIdentity,
} from "@/components/projetos/brief-wizard";
import type { BriefCapabilities } from "@/lib/site-factory/brief-schema";

export type { StudioIdentity };

export function NewProjectWizard({ studio }: { studio: StudioIdentity }) {
  return <BriefWizard mode="create" studio={studio} onSubmit={createProject} />;
}

async function createProject({
  brief,
  lead,
  projectName,
}: BriefWizardSubmission): Promise<BriefWizardResult> {
  // The step that collects it refuses to advance without a lead, so this is a
  // type guard rather than a case the operator can reach.
  if (!lead) return { ok: false, error: "Escolha o negócio que origina o projeto." };

  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: lead.id,
      name: projectName,
      sector: brief.sector.value,
      brief,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; capabilities?: BriefCapabilities; project?: { id?: string } }
    | null;

  if (!response.ok) return { ok: false, error: describeApiError(payload?.error) };

  const projectId = payload?.project?.id;
  return {
    ok: true,
    // The project page carries the primary action now, so the wizard hands the
    // operator straight to it instead of to the agent pipeline.
    destination: projectId ? `/projetos/${projectId}` : "/projetos",
    capabilities: payload?.capabilities ?? null,
  };
}
