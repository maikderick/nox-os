import "server-only";

import { type Actor } from "@/lib/authz/dal";
import { prisma } from "@/lib/db";

import {
  buildSiteContentSnapshot,
  buildSiteManifest,
  canonicalJsonStringify,
  hashSiteContent,
} from "@/lib/site-factory/site-export";
import { validateSnapshotInvariants } from "@/lib/site-factory/snapshot-contract";
import { writeAudit } from "@/lib/settings";

import { gitProviderFor, openProvisioningContext, runStep } from "./context";
import { hostingProjectNameFor } from "./naming";
import { ProvisioningRefusal } from "./reasons";
import { assertRepositoryReady } from "./step-order";
import { recordStepSuccess } from "./state";

export const CONTENT_PATH = "content/site.json";
export const MANIFEST_PATH = "content/manifest.json";

/**
 * Values that describe the template and the kit the site is built from.
 *
 * They come from the environment because only the generator knows them, and a
 * repository cannot honestly name the commit it is itself part of. The
 * placeholders exist so the whole path runs under the fake; a live run must
 * supply the real ones.
 */
function templateIdentity() {
  return {
    commit: process.env.NOX_SITE_TEMPLATE_COMMIT ?? "0".repeat(40),
    repository: `${process.env.NOX_SITE_TEMPLATE_OWNER ?? "maikderick"}/${
      process.env.NOX_SITE_TEMPLATE_REPO ?? "nox-site-template"
    }`,
    siteKit: {
      version: process.env.NOX_SITE_KIT_VERSION ?? "0.0.0-falso",
      sha256: process.env.NOX_SITE_KIT_SHA256 ?? "0".repeat(64),
    },
  };
}

export type ContentStepResult = {
  contentSha256: string;
  commitSha: string;
  /** True when the snapshot already in the repository was identical. */
  alreadyDone: boolean;
};

/**
 * Step 2 — commit the confirmed snapshot and its manifest.
 *
 * Everything that goes into the commit is derived from stored data, never from
 * the clock: a manifest that carried the current time would differ on every run
 * and defeat the whole point of not recommitting identical content.
 */
export async function provisionContent(params: {
  actor: Actor;
  siteProjectId: string;
}): Promise<ContentStepResult> {
  const context = await openProvisioningContext({
    actor: params.actor,
    siteProjectId: params.siteProjectId,
    provider: "github",
  });

  return runStep({ siteProjectId: params.siteProjectId, step: "content" }, async () => {
    // Before the provider: committing into a repository whose branch was never
    // protected produces a site nobody reviewed, and undoing it costs a real
    // resource.
    assertRepositoryReady(context.project);
    const repository = context.project.repository!;

    // Already parsed and verified by the eligibility gate; re-reading the row
    // here would be a second source of truth for the same bytes.
    const { brief, version: briefVersion, factsHash } = context.eligible;
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });

    const content = buildSiteContentSnapshot({
      brief,
      siteUrl: `https://${hostingProjectNameFor(context.project.client.slug)}.vercel.app`,
      privacy: {
        controllerName: settings?.brandName ?? "NOX OS",
        contactEmail: settings?.privacyEmail ?? null,
        // The settings row's own timestamp, so the snapshot changes only when
        // the policy actually changed.
        updatedAt: (settings?.updatedAt ?? context.project.currentBriefVersion!.createdAt).toISOString(),
        sections: [
          {
            heading: "Tratamento de dados",
            body: [
              "Os dados publicados neste site foram confirmados pelo estabelecimento e podem ser corrigidos ou removidos a pedido.",
            ],
          },
        ],
      },
    });

    // The contract is checked before anything leaves the building: a snapshot
    // that violates an invariant would produce a site nobody can fix remotely.
    const issues = validateSnapshotInvariants(content);
    if (issues.length > 0) {
      // Only the field paths, which come from our own contract — never the
      // message text, which a future validator could source from elsewhere.
      throw new ProvisioningRefusal("SNAPSHOT_INVALIDO", {
        fields: issues.map((issue) => issue.path),
      });
    }

    const contentSha256 = hashSiteContent(content);

    const manifest = buildSiteManifest({
      projectRef: context.project.id,
      briefVersion: briefVersion,
      factsHash: factsHash,
      content,
      templateCommit: templateIdentity().commit,
      templateRepository: templateIdentity().repository,
      siteKit: templateIdentity().siteKit,
      // Derived from the brief version, not from now: the same brief must
      // produce the same bytes however many times this runs.
      generatedAt: context.project.currentBriefVersion!.createdAt.toISOString(),
    });

    const provisioning = context.project.provisioning;
    if (provisioning?.contentSha256 === contentSha256 && provisioning.commitSha) {
      return {
        contentSha256,
        commitSha: provisioning.commitSha,
        alreadyDone: true,
      };
    }

    const provider = await gitProviderFor(context);
    const commit = await provider.commitFiles({
      repo: {
        owner: repository.owner,
        name: repository.name,
        externalId: repository.externalId,
        url: repository.url,
        defaultBranch: repository.defaultBranch,
        templateRepository: null,
      },
      branch: repository.defaultBranch,
      message: `conteúdo: briefing v${briefVersion}`,
      files: [
        { path: CONTENT_PATH, content: canonicalJsonStringify(content) },
        { path: MANIFEST_PATH, content: canonicalJsonStringify(manifest) },
      ],
    });

    await prisma.$transaction(async (tx) => {
      await recordStepSuccess({
        siteProjectId: context.project.id,
        step: "content",
        data: { contentSha256, commitSha: commit.sha },
        db: tx,
      });

      await writeAudit({
        db: tx,
        userId: context.actor.userId,
        action: "provisioning.content.commit",
        entity: "SiteProject",
        entityId: context.project.id,
        meta: {
          mode: context.mode,
          briefVersion: briefVersion,
          contentSha256,
          commitSha: commit.sha,
        },
      });
    });

    return { contentSha256, commitSha: commit.sha, alreadyDone: false };
  });
}
