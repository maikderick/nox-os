import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ProjectSite } from "@/components/sites/project-site";
import { prisma } from "@/lib/db";
import { parseSiteBrief } from "@/lib/site-factory/brief-schema";
import { publicBusinessName } from "@/lib/site-factory/display-name";
import { hasInternalPreview, isSiteProjectState } from "@/lib/site-factory/states";

const loadPublicSite = cache(async (id: string) => {
  const project = await prisma.siteProject.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      currentBriefVersion: { select: { contentJson: true } },
    },
  });

  if (
    !project?.currentBriefVersion ||
    !isSiteProjectState(project.status) ||
    !hasInternalPreview(project.status)
  ) {
    return null;
  }

  try {
    return { project, brief: parseSiteBrief(project.currentBriefVersion.contentJson) };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicSite(id);
  if (!result) return { title: "Site indisponível", robots: { index: false, follow: false } };

  return {
    // Same helper the body uses: a tab that says "ZEN COMIDA JAPONESA" over a
    // page that says "Zen Comida Japonesa" is one page with two names.
    title: publicBusinessName(result.brief),
    description:
      result.brief.schemaVersion === 2 && result.brief.metaDescription
        ? result.brief.metaDescription.value
        : result.brief.positioning.value,
    robots: { index: false, follow: false },
  };
}

export default async function PublicSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadPublicSite(id);
  if (!result) notFound();
  return <ProjectSite brief={result.brief} seed={result.project.id} />;
}
