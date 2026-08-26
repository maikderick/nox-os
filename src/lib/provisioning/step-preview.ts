import "server-only";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

import type { DeploymentInfo } from "@/lib/providers/types";
import { writeAudit } from "@/lib/settings";

import { hostingProviderFor, openProvisioningContext, runStep } from "./context";
import { assertContentPublished, assertHostingReady } from "./step-order";
import { recordStepSuccess } from "./state";

export type PreviewStepResult = {
  preview: {
    externalId: string | null;
    url: string | null;
    state: string | null;
    commitSha: string;
    checkedAt: Date;
  };
  /** True when the platform has not produced a build for this commit yet. */
  pending: boolean;
};

/**
 * Picks the deployment that speaks for a commit.
 *
 * A commit can have several — a retry, a cancelled build. `READY` wins because
 * that is the one an operator can open; otherwise the most recent attempt is
 * what explains the current state.
 */
export function chooseDeployment(deployments: DeploymentInfo[]): DeploymentInfo | null {
  if (deployments.length === 0) return null;
  const ready = deployments.find((deployment) => deployment.state === "READY");
  if (ready) return ready;
  return [...deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * Step 4 — ask the platform what it built, and record the answer.
 *
 * Polling is the source of truth. There is no webhook and no queue in this
 * phase: a person presses the button, the factory asks at that instant, stores
 * what it found, and shows it. Anything else would need durable work, which is
 * a later phase.
 */
export async function reconcilePreview(params: {
  actor: Actor;
  siteProjectId: string;
}): Promise<PreviewStepResult> {
  const context = await openProvisioningContext({
    actor: params.actor,
    siteProjectId: params.siteProjectId,
    provider: "vercel",
  });

  return runStep(
    { siteProjectId: params.siteProjectId, step: "reconcile-preview" },
    async () => {
      assertHostingReady(context.project);
      assertContentPublished(context.project);
      const hosting = context.project.hostingProject!;
      const commitSha = context.project.provisioning!.commitSha!;

      const provider = await hostingProviderFor(context);
      const deployments = await provider.listDeployments({
        project: {
          externalId: hosting.externalId ?? "",
          name: hosting.name,
          url: hosting.url,
          linkedRepository: null,
        },
        commitSha,
      });

      const chosen = chooseDeployment(deployments);
      const checkedAt = new Date();

      // A commit with no build yet is a normal answer, not a failure: the
      // platform may still be working. The step records that it asked — and the
      // record and its audit entry commit together.
      await prisma.$transaction(async (tx) => {
        await recordStepSuccess({
          siteProjectId: context.project.id,
          step: "reconcile-preview",
          data: {
            previewUrl: chosen?.url ?? null,
            previewExternalId: chosen?.externalId ?? null,
            previewCheckedAt: checkedAt,
          },
          db: tx,
        });

        await writeAudit({
          db: tx,
          userId: context.actor.userId,
          action: "provisioning.preview.reconcile",
          entity: "SiteProject",
          entityId: context.project.id,
          meta: {
            mode: context.mode,
            commitSha,
            found: deployments.length,
            state: chosen?.state ?? null,
          },
        });
      });

      return {
        preview: {
          externalId: chosen?.externalId ?? null,
          url: chosen?.url ?? null,
          state: chosen?.state ?? null,
          commitSha,
          checkedAt,
        },
        pending: chosen === null || chosen.state !== "READY",
      };
    },
  );
}
