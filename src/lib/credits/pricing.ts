import type { Prisma } from "@prisma/client";

import { assertAmountCents, CreditRefusal } from "./reasons";

/**
 * What a generation costs, for one organization.
 *
 * **Local policy, and nothing else.** This module reaches no network, resolves
 * no `SecretRef`, and constructs no provider client — the price is a number
 * someone who operates the factory put in a column, not something a provider is
 * asked about mid-flight. A test walks this module's imports to keep it that
 * way, because the tempting change is small: "just ask the provider what it
 * charges", and then reserving credit depends on the provider being up, which
 * is precisely the moment reserving credit has to work.
 *
 * A null price is not free. It means nobody said, and generating without a
 * price is spending without knowing how much — so it refuses.
 */
export type PriceReader = Pick<Prisma.TransactionClient, "creditAccount">;

export async function generationPriceCents(
  db: PriceReader,
  organizationId: string,
): Promise<number> {
  const account = await db.creditAccount.findUnique({
    where: { organizationId },
    select: { generationPriceCents: true },
  });

  if (!account) throw new CreditRefusal("CONTA_NAO_ENCONTRADA");
  if (account.generationPriceCents === null) throw new CreditRefusal("PRECO_NAO_CONFIGURADO");

  // The column allows any positive integer; this narrows it to what the rest of
  // the machinery accepts, so a row written by a script cannot widen the domain.
  assertAmountCents(account.generationPriceCents);
  return account.generationPriceCents;
}
