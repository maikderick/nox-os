import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

function pointsToLocalPostgres(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const hostname = new URL(databaseUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

const describeLocalDatabase = pointsToLocalPostgres(process.env.DATABASE_URL)
  ? describe
  : describe.skip;

/**
 * These rules live in the database, not in the application, so they are the only
 * ones that still hold when a row is written by a migration, a script, or a
 * console. Asserting them anywhere but against a real PostgreSQL would be
 * asserting a belief about PostgreSQL.
 */
describeLocalDatabase("SecretRef, against the database itself", () => {
  const token = randomUUID().slice(0, 8);
  const purpose = `teste.${token}`;
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      prisma.organization.create({
        data: { name: `Org A ${token}`, slug: `secretref-a-${token}` },
      }),
      prisma.organization.create({
        data: { name: `Org B ${token}`, slug: `secretref-b-${token}` },
      }),
    ]);
    organizationId = a.id;
    otherOrganizationId = b.id;
  });

  afterAll(async () => {
    await prisma.secretRef.deleteMany({ where: { purpose: { contains: token } } });
    await prisma.organization.deleteMany({ where: { slug: { contains: token } } });
  });

  describe("scope and owner have to agree", () => {
    it("refuses a platform secret that names an organization", async () => {
      await expect(
        prisma.secretRef.create({
          data: {
            scope: "PLATAFORMA",
            organizationId,
            purpose: `${purpose}.a`,
            envVarName: "TESTE_A",
          },
        }),
      ).rejects.toThrow(/SecretRef_scope_owner_ck|constraint/i);
    });

    it("refuses an organization secret that names none", async () => {
      await expect(
        prisma.secretRef.create({
          data: {
            scope: "ORGANIZACAO",
            organizationId: null,
            purpose: `${purpose}.b`,
            envVarName: "TESTE_B",
          },
        }),
      ).rejects.toThrow(/SecretRef_scope_owner_ck|constraint/i);
    });

    it("refuses a scope that is neither", async () => {
      await expect(
        prisma.secretRef.create({
          data: {
            scope: "GLOBAL",
            organizationId: null,
            purpose: `${purpose}.c`,
            envVarName: "TESTE_C",
          },
        }),
      ).rejects.toThrow(/SecretRef_scope_owner_ck|constraint/i);
    });

    it("accepts both coherent shapes", async () => {
      const platform = await prisma.secretRef.create({
        data: { scope: "PLATAFORMA", purpose: `${purpose}.ok`, envVarName: "TESTE_OK" },
      });
      const scoped = await prisma.secretRef.create({
        data: {
          scope: "ORGANIZACAO",
          organizationId,
          purpose: `${purpose}.ok`,
          envVarName: "TESTE_OK_ORG",
        },
      });

      expect(platform.organizationId).toBeNull();
      expect(scoped.organizationId).toBe(organizationId);
    });
  });

  describe("one row per purpose", () => {
    it("refuses a second platform secret for the same purpose", async () => {
      // The composite index this replaced could not do this: NULL is never equal
      // to NULL, so every platform row looked distinct to it.
      await prisma.secretRef.create({
        data: { scope: "PLATAFORMA", purpose: `${purpose}.dup`, envVarName: "TESTE_DUP_1" },
      });

      await expect(
        prisma.secretRef.create({
          data: { scope: "PLATAFORMA", purpose: `${purpose}.dup`, envVarName: "TESTE_DUP_2" },
        }),
      ).rejects.toThrow(/SecretRef_purpose_plataforma_key|unique/i);
    });

    it("refuses a second secret for the same purpose in one organization", async () => {
      await prisma.secretRef.create({
        data: {
          scope: "ORGANIZACAO",
          organizationId,
          purpose: `${purpose}.org`,
          envVarName: "TESTE_ORG_1",
        },
      });

      await expect(
        prisma.secretRef.create({
          data: {
            scope: "ORGANIZACAO",
            organizationId,
            purpose: `${purpose}.org`,
            envVarName: "TESTE_ORG_2",
          },
        }),
      ).rejects.toThrow(/SecretRef_purpose_organizacao_key|unique/i);
    });

    it("lets two organizations hold the same purpose", async () => {
      const first = await prisma.secretRef.create({
        data: {
          scope: "ORGANIZACAO",
          organizationId,
          purpose: `${purpose}.shared`,
          envVarName: "TESTE_SHARED_A",
        },
      });
      const second = await prisma.secretRef.create({
        data: {
          scope: "ORGANIZACAO",
          organizationId: otherOrganizationId,
          purpose: `${purpose}.shared`,
          envVarName: "TESTE_SHARED_B",
        },
      });

      expect(first.id).not.toBe(second.id);
    });

    it("lets a platform purpose coexist with the same purpose in an organization", async () => {
      await prisma.secretRef.create({
        data: {
          scope: "PLATAFORMA",
          purpose: `${purpose}.both`,
          envVarName: "TESTE_BOTH_GLOBAL",
        },
      });

      await expect(
        prisma.secretRef.create({
          data: {
            scope: "ORGANIZACAO",
            organizationId,
            purpose: `${purpose}.both`,
            envVarName: "TESTE_BOTH_ORG",
          },
        }),
      ).resolves.toMatchObject({ scope: "ORGANIZACAO" });
    });
  });

  it("never has a column that could hold the value", async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'SecretRef'`,
    );
    const names = columns.map((column) => column.column_name);

    expect(names).toContain("envVarName");
    expect(names).toContain("fingerprint");
    for (const forbidden of ["value", "secret", "token", "privateKey"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
