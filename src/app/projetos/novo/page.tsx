import { requirePermission } from "@/lib/authz/dal";
import { NewProjectWizard } from "@/components/projetos/novo-projeto-wizard";
import { requireUser } from "@/lib/session";

export default async function NewProjectPage() {
  await requireUser();
  await requirePermission("project:write");
  return <NewProjectWizard />;
}
