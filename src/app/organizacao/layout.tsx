import type { Metadata } from "next";
import Link from "next/link";

import { Providers } from "@/components/providers";
import { requirePermission } from "@/lib/authz/dal";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Organização · NOX OS",
  robots: { index: false, follow: false },
};

export default async function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  const actor = await requirePermission("org:read");

  return (
    <Providers>
      <div className="min-h-screen bg-nox-bg text-nox-text">
        <header className="border-b border-nox-border bg-nox-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-7">
              <Link href="/projetos" className="font-semibold tracking-tight">
                <span className="text-nox-cyan">NOX</span> OS · Organização
              </Link>
              <nav
                className="hidden items-center gap-4 text-sm text-nox-muted md:flex"
                aria-label="Organização"
              >
                <Link href="/organizacao/integracoes" className="hover:text-white">
                  Integrações
                </Link>
                <Link href="/projetos" className="hover:text-white">
                  Fábrica
                </Link>
                <Link href="/leads" className="hover:text-white">
                  Prospecção
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3 text-sm text-nox-muted">
              <span className="hidden sm:inline">{actor.organizationName}</span>
              <span className="rounded-full border border-nox-border px-2 py-1 text-xs text-nox-cyan">
                {actor.role}
              </span>
            </div>
          </div>
        </header>
        <main className="nox-grid min-h-[calc(100vh-57px)]">
          <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
        </main>
      </div>
    </Providers>
  );
}
