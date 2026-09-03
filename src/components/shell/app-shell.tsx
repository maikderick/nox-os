"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CircleUserRound,
  ExternalLink,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Plug,
  Plus,
  Search,
  Settings,
  Target,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the route exactly instead of by prefix. */
  exact?: boolean;
  hidden?: boolean;
};

export type AppShellProps = {
  children: React.ReactNode;
  brandName: string;
  user: { email: string; name?: string | null };
  organizationName?: string | null;
  role?: string | null;
  canManageUsers: boolean;
  canManageOrganization: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Dono",
  ADMIN: "Administrador",
  OPERADOR: "Operador",
  LEITOR: "Leitor",
};

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppShell({
  children,
  brandName,
  user,
  organizationName,
  role,
  canManageUsers,
  canManageOrganization,
}: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  const operation: NavItem[] = [
    { href: "/leads", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/projetos", label: "Projetos", icon: FolderKanban },
    { href: "/leads/import", label: "Prospecção", icon: Search },
    { href: "/leads/opportunities", label: "Meus leads", icon: Target },
    { href: "/leads/map", label: "Mapa", icon: MapIcon },
  ];

  const organization: NavItem[] = [
    { href: "/organizacao/integracoes", label: "Integrações", icon: Plug, hidden: !canManageOrganization },
    { href: "/leads/settings", label: "Configurações", icon: Settings },
    { href: "/leads/users", label: "Usuários", icon: Users, hidden: !canManageUsers },
  ];

  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : null;
  const displayName = user.name?.trim() || user.email;

  // Following a link closes the drawer on small screens.
  const sidebar = (
    <div
      className="flex h-full flex-col"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) setOpen(false);
      }}
    >
      <div className="flex items-center justify-between px-5 pt-5">
        <Link href="/leads" className="flex items-center gap-2.5" aria-label={`${brandName} — início`}>
          <BrandMark />
          <span className="text-base font-semibold tracking-tight">
            <span className="text-nox-cyan">NOX</span> <span className="text-white">OS</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="nox-btn-ghost -mr-2 p-2 lg:hidden"
          aria-label="Fechar menu"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 pt-6">
        <Link href="/projetos/novo" className="nox-btn-primary w-full">
          <Plus size={16} aria-hidden="true" /> Novo projeto
        </Link>
      </div>

      <nav className="mt-6 flex-1 space-y-6 overflow-y-auto px-3 nox-scroll" aria-label="Painel">
        <NavGroup title="Operação" items={operation} pathname={pathname} />
        <NavGroup title="Organização" items={organization} pathname={pathname} />
      </nav>

      <div className="border-t border-nox-border p-3">
        <Link
          href="/leads/account"
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-nox-panel",
            pathname === "/leads/account" ? "bg-nox-panel text-white" : "text-nox-muted",
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-nox-border bg-nox-panel text-nox-cyan">
            <CircleUserRound size={18} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-white">{displayName}</span>
            <span className="block truncate text-xs text-nox-muted">
              {[organizationName, roleLabel].filter(Boolean).join(" · ") || user.email}
            </span>
          </span>
        </Link>
        <div className="mt-1 flex items-center gap-1">
          <Link href="/" className="nox-btn-ghost flex-1 justify-start px-3 py-2 text-xs">
            <ExternalLink size={14} aria-hidden="true" /> Ver site público
          </Link>
          <Link href="/api/auth/signout" className="nox-btn-ghost px-3 py-2 text-xs" aria-label="Sair">
            <LogOut size={14} aria-hidden="true" /> Sair
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-nox-bg text-nox-text">
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[var(--nox-sidebar-w)] border-r border-nox-border bg-nox-surface lg:block"
        aria-label="Navegação principal"
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[min(88vw,var(--nox-sidebar-w))] border-r border-nox-border bg-nox-surface shadow-2xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[var(--nox-sidebar-w)]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-nox-border bg-nox-bg/85 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nox-btn-ghost -ml-2 p-2 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link href="/leads" className="text-sm font-semibold lg:hidden">
            <span className="text-nox-cyan">NOX</span> OS
          </Link>
          <div className="ml-auto flex items-center gap-2 text-xs text-nox-muted">
            {organizationName ? (
              <span className="hidden items-center gap-1.5 rounded-full border border-nox-border bg-nox-surface px-3 py-1 sm:inline-flex">
                <Building2 size={12} aria-hidden="true" /> {organizationName}
              </span>
            ) : null}
            {roleLabel ? (
              <span className="rounded-full border border-nox-cyan/30 bg-nox-cyan/10 px-3 py-1 font-medium text-nox-cyan">
                {roleLabel}
              </span>
            ) : null}
          </div>
        </header>
        <main className="nox-glow-soft min-h-[calc(100vh-3.5rem)]">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavGroup({ title, items, pathname }: { title: string; items: NavItem[]; pathname: string }) {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  return (
    <div>
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-nox-muted/80">{title}</p>
      <ul className="space-y-0.5">
        {visible.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-nox-cyan/10 text-white" : "text-nox-muted hover:bg-nox-panel hover:text-white",
                )}
              >
                {active ? (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-nox-cyan" aria-hidden="true" />
                ) : null}
                <Icon
                  size={17}
                  aria-hidden="true"
                  className={cn("shrink-0", active ? "text-nox-cyan" : "text-nox-muted group-hover:text-white")}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-lg border border-nox-cyan/40 bg-nox-cyan/10",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M5 19V5l14 14V5" className="text-nox-cyan" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
