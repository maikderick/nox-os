import { requirePermission } from "@/lib/authz/dal";
import { requireUser } from "@/lib/session";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  await requirePermission("org:manage_members");
  return children;
}
