import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/providers";
import { requirePermission } from "@/lib/authz/dal";
import { roleHasPermission } from "@/lib/authz/permissions";
import { requireUser } from "@/lib/session";
import { ensureDefaultSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Organização",
  robots: { index: false, follow: false },
};

export default async function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireUser();
  const actor = await requirePermission("org:read");
  const settings = await ensureDefaultSettings();

  return (
    <Providers>
      <AppShell
        brandName={settings.brandName}
        user={{ email: session.user?.email ?? actor.email, name: session.user?.name ?? actor.name }}
        organizationName={actor.organizationName}
        role={actor.role}
        canManageUsers={roleHasPermission(actor.role, "org:manage_members")}
        canManageOrganization
        canReadJobs={roleHasPermission(actor.role, "job:read")}
      >
        <div className="mx-auto max-w-5xl">{children}</div>
      </AppShell>
    </Providers>
  );
}
