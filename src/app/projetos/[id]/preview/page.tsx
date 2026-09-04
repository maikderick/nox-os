import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProjectSite } from "@/components/sites/project-site";
import { SiteFonts } from "@/components/sites/site-fonts";
import { requirePermission } from "@/lib/authz/dal";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { getSiteProject } from "@/lib/site-factory/project-service";
import { hasInternalPreview, isSiteProjectState } from "@/lib/site-factory/states";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Prévia do site",
  robots: { index: false, follow: false },
};

/**
 * The internal preview is the same site under admin chrome.
 *
 * It used to be a second copy of the renderer, which meant every visual fix had
 * to be made twice and the two were free to disagree about what the client
 * would receive. The chrome is the only thing this page owns.
 */
export default async function ProjectPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const actor = await requirePermission("project:read");
  const { id } = await params;
  const project = await getSiteProject(actor, id);

  if (!isSiteProjectState(project.status) || !hasInternalPreview(project.status)) {
    redirect(`/projetos/${project.id}/geracao`);
  }

  const currentBrief = project.briefVersions.find(
    (brief) => brief.id === project.currentBriefVersionId,
  );
  if (!currentBrief) redirect(`/projetos/${project.id}/geracao`);

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-nox-border bg-nox-bg px-5 py-3 text-sm">
        <Link href={`/projetos/${project.id}`} className="text-nox-muted hover:text-white">
          Voltar ao projeto
        </Link>
        <span className="rounded-full border border-nox-border px-3 py-1 text-xs text-nox-muted">
          Prévia interna
        </span>
      </div>
      <SiteFonts>
        <ProjectSite brief={parseSiteBrief(currentBrief.contentJson)} seed={project.id} />
      </SiteFonts>
    </>
  );
}
