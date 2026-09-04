import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDemoLandingExpired } from "@/lib/demo-landing";
import { isSafeDemoHttpsUrl, parseDemoLandingContent } from "@/lib/demo-landing-schema";
import { hasOwnWebsite } from "@/lib/website";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Serves a site built outside NOX OS through the demo's own address, so the same
 * validity window applies: once the demo expires, the shared link stops working
 * exactly like the preview does. Anything unavailable falls back to the demo
 * page, which already renders the expired and unavailable states.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const fallback = () =>
    NextResponse.redirect(new URL(`/demo/${encodeURIComponent(slug)}`, req.url).toString(), {
      status: 302,
      headers: { "X-Robots-Tag": "noindex, nofollow" },
    });

  const landing = await prisma.demoLanding.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      contentJson: true,
      business: { select: { website: true } },
    },
  });

  if (!landing) return fallback();

  if (landing.status === "EXPIRED" || isDemoLandingExpired(landing.expiresAt)) {
    if (landing.status !== "EXPIRED") {
      await prisma.demoLanding.update({
        where: { id: landing.id },
        data: { status: "EXPIRED" },
      });
    }
    return fallback();
  }

  if (landing.status !== "APPROVED") return fallback();

  if (hasOwnWebsite(landing.business.website)) return fallback();

  let target = "";
  try {
    target = parseDemoLandingContent(landing.contentJson).builtSiteUrl.trim();
  } catch {
    return fallback();
  }

  // Re-validated here so a malformed stored value can never turn this route into
  // an open redirect.
  if (!target || !isSafeDemoHttpsUrl(target)) return fallback();

  return NextResponse.redirect(new URL(target).toString(), {
    status: 302,
    headers: { "X-Robots-Tag": "noindex, nofollow" },
  });
}
