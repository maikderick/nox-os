import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("O bootstrap FALSO é exclusivo do ambiente local.");
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) throw new Error("ADMIN_EMAIL não está configurado.");

  const membership = await prisma.organizationMembership.findFirst({
    where: { user: { email: adminEmail }, active: true, organization: { active: true } },
    select: { organizationId: true, userId: true },
  });
  if (!membership) throw new Error("Execute npm run db:seed antes do bootstrap local.");

  await prisma.$transaction(async (tx) => {
    for (const provider of ["github", "vercel", "cursor"] as const) {
      await tx.integrationSetting.upsert({
        where: {
          organizationId_provider: {
            organizationId: membership.organizationId,
            provider,
          },
        },
        create: {
          organizationId: membership.organizationId,
          provider,
          mode: "FALSO",
          enabledById: membership.userId,
          enabledAt: new Date(),
        },
        update: {
          mode: "FALSO",
          enabledById: membership.userId,
          enabledAt: new Date(),
        },
      });
    }

    const existingAccount = await tx.creditAccount.findUnique({
      where: { organizationId: membership.organizationId },
      select: { organizationId: true },
    });
    if (!existingAccount) {
      await tx.creditAccount.create({
        data: {
          organizationId: membership.organizationId,
          balanceCents: 100_000,
          monthlyCapCents: 100_000,
          generationPriceCents: 1_000,
        },
      });
      await tx.creditLedgerEntry.create({
        data: {
          organizationId: membership.organizationId,
          movement: "APORTE",
          amountCents: 100_000,
          balanceAfterCents: 100_000,
          reservedAfterCents: 0,
          consumedAfterCents: 0,
          reasonCode: "APORTE_INICIAL_LOCAL",
          actorId: membership.userId,
        },
      });
    }
  });

  console.log("Integrações locais em modo FALSO e créditos de demonstração configurados.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
