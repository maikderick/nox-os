import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/providers";
import { authOptions } from "@/lib/auth";
import { getActor } from "@/lib/authz/dal";
import { roleHasPermission } from "@/lib/authz/permissions";
import { ensureDefaultSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Painel",
  robots: { index: false, follow: false },
};

export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const settings = await ensureDefaultSettings();
  const actor = await getActor();
  const canManageUsers = actor ? roleHasPermission(actor.role, "org:manage_members") : false;
  const canManageOrganization = actor ? roleHasPermission(actor.role, "org:read") : false;

  return (
    <Providers>
      <AppShell
        brandName={settings.brandName}
        user={{ email: session.user.email ?? "", name: session.user.name }}
        organizationName={actor?.organizationName ?? null}
        role={actor?.role ?? null}
        canManageUsers={canManageUsers}
        canManageOrganization={canManageOrganization}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
