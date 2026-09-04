import { requirePermission } from "@/lib/authz/dal";
import { NewProjectWizard } from "@/components/projetos/novo-projeto-wizard";
import { publicValue } from "@/lib/brand";
import { requireUser } from "@/lib/session";
import { ensureDefaultSettings } from "@/lib/settings";

export default async function NewProjectPage() {
  await requireUser();
  await requirePermission("project:write");
  const settings = await ensureDefaultSettings();
  return (
    <NewProjectWizard
      studio={{
        brandName: publicValue(settings.brandName) ?? "NOX OS",
        sellerName: publicValue(settings.sellerName),
        city: publicValue(settings.defaultCity),
      }}
    />
  );
}
