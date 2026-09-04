import type { Prisma } from "@prisma/client";

/**
 * Either the pooled client or the client bound to an open interactive
 * transaction. Services take one of these so a caller can compose several of
 * them into a single unit of work instead of each opening its own.
 */
export type SiteFactoryDb = Prisma.TransactionClient;
