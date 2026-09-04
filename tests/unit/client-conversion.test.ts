import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  businessFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  clientCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    business: { findUnique: mocks.businessFindUnique },
    client: { findUnique: mocks.clientFindUnique, create: mocks.clientCreate },
  },
}));

import type { Actor } from "../../src/lib/authz/dal";
import { convertBusinessToClient } from "../../src/lib/site-factory/client-service";

const actor: Actor = {
  userId: "user-1",
  email: "admin@example.com",
  name: "Admin",
  organizationId: "org-1",
  organizationSlug: "nox-os",
  organizationName: "NOX OS",
  membershipId: "membership-1",
  role: "ADMIN",
  permissions: ["client:read", "client:write"],
};

describe("Business to Client conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessFindUnique.mockResolvedValue({ id: "lead-1", name: "Padaria Aurora" });
    mocks.clientFindUnique.mockResolvedValue(null);
    mocks.clientCreate.mockImplementation(async ({ data }) => ({ id: "client-1", ...data }));
  });

  it("is idempotent for the same business", async () => {
    const existing = { id: "client-1", businessId: "lead-1", organizationId: "org-1" };
    mocks.clientFindUnique.mockResolvedValueOnce(existing);
    await expect(convertBusinessToClient({ actor, businessId: "lead-1" })).resolves.toEqual(existing);
    expect(mocks.clientCreate).not.toHaveBeenCalled();
  });

  it("copies only identity and the relation, not contact or location data", async () => {
    const client = await convertBusinessToClient({ actor, businessId: "lead-1" });
    expect(client).toMatchObject({ businessId: "lead-1", name: "Padaria Aurora" });
    const data = mocks.clientCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toEqual({
      organizationId: "org-1",
      businessId: "lead-1",
      name: "Padaria Aurora",
      slug: "padaria-aurora",
    });
    expect(data).not.toHaveProperty("address");
    expect(data).not.toHaveProperty("phoneE164");
    expect(data).not.toHaveProperty("socialLinks");
  });
});
