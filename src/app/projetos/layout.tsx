import type { Metadata } from "next";
import Link from "next/link";

import { Providers } from "@/components/providers";
import { requirePermission } from "@/lib/authz/dal";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Fábrica de sites",
  robots: { index: false, follow: false },
};

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const actor = await requirePermission("project:read");

  return (
    <Providers>
      <div className="min-h-screen bg-nox-bg text-nox-text">
        <header className="border-b border-nox-border bg-nox-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-7">
              <Link href="/projetos" className="font-semibold tracking-tight">
                <span className="text-nox-cyan">NOX</span> OS · Fábrica
              </Link>
              <nav className="hidden items-center gap-4 text-sm text-nox-muted md:flex" aria-label="Fábrica de sites">
                <Link href="/projetos" className="hover:text-white">Projetos</Link>
                <Link href="/projetos/novo" className="hover:text-white">Novo projeto</Link>
                <Link href="/leads" className="hover:text-white">Prospecção</Link>
                <Link href="/organizacao/integracoes" className="hover:text-white">Organização</Link>
              </nav>
              <details className="relative md:hidden">
                <summary className="list-none rounded-lg border border-nox-border px-3 py-2 text-sm text-nox-muted">
                  Menu
                </summary>
                <nav
                  className="absolute left-0 top-12 z-20 grid min-w-48 gap-1 rounded-lg border border-nox-border bg-nox-surface p-2 text-sm shadow-xl"
                  aria-label="Navegação da fábrica"
                >
                  <Link href="/projetos" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Projetos</Link>
                  <Link href="/projetos/novo" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Novo projeto</Link>
                  <Link href="/leads" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Prospecção</Link>
                  <Link href="/organizacao/integracoes" className="rounded px-3 py-2 hover:bg-nox-panel hover:text-white">Organização</Link>
                </nav>
              </details>
            </div>
            <div className="flex items-center gap-3 text-sm text-nox-muted">
              <span className="hidden sm:inline">{actor.organizationName}</span>
              <span className="rounded-full border border-nox-border px-2 py-1 text-xs text-nox-cyan">
                {actor.role}
              </span>
              <Link href="/api/auth/signout" className="hover:text-white">Sair</Link>
            </div>
          </div>
        </header>
        <main className="nox-grid min-h-[calc(100vh-57px)]">
          <div className="mx-auto max-w-7xl px-4 py-8">{children}</div>
        </main>
      </div>
    </Providers>
  );
}
