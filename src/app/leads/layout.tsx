import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { ensureDefaultSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Painel de prospecção",
  robots: { index: false, follow: false },
};

export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  await ensureDefaultSettings();

  return (
    <Providers>
      <div className="min-h-screen bg-nox-bg text-nox-text">
        <header className="border-b border-nox-border bg-nox-surface/80">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-6">
              <Link href="/leads" className="font-semibold">
                <span className="text-nox-cyan">NOX</span> OS · Leads
              </Link>
              <nav className="hidden gap-4 text-sm text-nox-muted md:flex" aria-label="Painel">
                <Link href="/leads" className="hover:text-white">
                  Dashboard
                </Link>
                <Link href="/leads/opportunities" className="hover:text-white">
                  Melhores oportunidades
                </Link>
                <Link href="/leads/import" className="hover:text-white">
                  Importação
                </Link>
                <Link href="/leads/map" className="hover:text-white">
                  Mapa
                </Link>
                <Link href="/leads/settings" className="hover:text-white">
                  Configurações
                </Link>
                {session.user.role === "admin" && (
                  <Link href="/leads/users" className="hover:text-white">
                    Usuários
                  </Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3 text-sm text-nox-muted">
              <span>{session.user.email}</span>
              <Link href="/leads/account" className="hover:text-white">
                Minha conta
              </Link>
              <Link href="/" className="hover:text-white">
                Site
              </Link>
              <Link href="/api/auth/signout" className="text-nox-cyan hover:underline">
                Sair
              </Link>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </div>
    </Providers>
  );
}
