import "server-only";

import { prisma } from "@/lib/db";

import { ensureDefaultOrganizationOn } from "./bootstrap-core";

/** Runs the bootstrap against the application's client, inside a transaction. */
export async function ensureDefaultOrganization(user: {
  id: string;
  role?: string | null;
  active?: boolean;
}) {
  return prisma.$transaction((tx) => ensureDefaultOrganizationOn(tx, user));
}

export { ensureDefaultOrganizationOn };
