import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureDefaultOrganizationOn } from "../../src/lib/organizations/bootstrap-core";

type Db = Parameters<typeof ensureDefaultOrganizationOn>[0];

function fakeDb(overrides: {
  existing?: unknown;
  memberCount?: number;
}) {
  const create = vi.fn(async (args: unknown) => args);
  const db = {
    organization: { upsert: vi.fn(async () => ({ id: "org-1" })) },
    organizationMembership: {
      findUnique: vi.fn(async () => overrides.existing ?? null),
      count: vi.fn(async () => overrides.memberCount ?? 0),
      create,
    },
  };
  return { db: db as unknown as Db, create, raw: db };
}

describe("default organization bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes the first member the owner", async () => {
    const { db, create } = fakeDb({ memberCount: 0 });

    await ensureDefaultOrganizationOn(db, { id: "user-1", role: "admin" });

    expect(create.mock.calls[0][0]).toMatchObject({
      data: { organizationId: "org-1", userId: "user-1", role: "OWNER", active: true },
    });
  });

  it("maps a later account from its legacy role", async () => {
    const { db, create } = fakeDb({ memberCount: 3 });

    await ensureDefaultOrganizationOn(db, { id: "user-2", role: "operator" });

    expect(create.mock.calls[0][0]).toMatchObject({ data: { role: "OPERADOR" } });
  });

  it("falls back to least privilege for an unknown legacy role", async () => {
    const { db, create } = fakeDb({ memberCount: 3 });

    await ensureDefaultOrganizationOn(db, { id: "user-3", role: "inesperado" });

    expect(create.mock.calls[0][0]).toMatchObject({ data: { role: "LEITOR" } });
  });

  it("never reactivates a membership an administrator switched off", async () => {
    const deactivated = { id: "membership-1", active: false, role: "OPERADOR" };
    const { db, create, raw } = fakeDb({ existing: deactivated });

    const result = await ensureDefaultOrganizationOn(db, {
      id: "user-4",
      role: "admin",
      active: true,
    });

    expect(result).toBe(deactivated);
    expect(create).not.toHaveBeenCalled();
    expect(raw.organizationMembership.count).not.toHaveBeenCalled();
  });
});
