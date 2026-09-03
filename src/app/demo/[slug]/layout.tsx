import type { Metadata } from "next";

import { SiteFrame } from "@/components/site/shell";
import { SiteUnavailable } from "@/components/site/unavailable";
import { loadSite } from "@/lib/site-view";

type LayoutProps = { children: React.ReactNode; params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) {
    return {
      title: "Site indisponível",
      robots: { index: false, follow: false, nocache: true },
    };
  }
  const { site } = result;
  const description = site.content.subheadline || site.content.eyebrow || site.business.category;
  return {
    title: { default: site.business.name, template: `%s · ${site.business.name}` },
    description,
    openGraph: {
      title: site.business.name,
      description,
      images: site.heroImage ? [{ url: site.heroImage }] : undefined,
      locale: "pt_BR",
      type: "website",
    },
    // Previews are not for search engines; the definitive site gets indexed
    // when it is published under the client's own domain.
    robots: site.isPermanent
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  };
}

export default async function SiteLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const result = await loadSite(slug);
  if (!result.ok) return <SiteUnavailable reason={result.reason} />;
  return <SiteFrame site={result.site}>{children}</SiteFrame>;
}
