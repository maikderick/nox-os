import { beforeEach, describe, expect, it, vi } from "vitest";

const roleBox = vi.hoisted(() => ({
  role: "LEITOR" as "ADMIN" | "OPERADOR" | "LEITOR",
}));

const mocks = vi.hoisted(() => ({
  jobUpdateMany: vi.fn(),
  jobFindFirst: vi.fn(),
  jobFindMany: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdate: vi.fn(),
  businessCount: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/authz/dal", async () => {
  const { dalMock } = await import("../helpers/authz-mock");
  return dalMock(roleBox);
});
vi.mock("@/lib/db", () => ({
  prisma: {
    importJob: {
      updateMany: mocks.jobUpdateMany,
      findFirst: mocks.jobFindFirst,
      findMany: mocks.jobFindMany,
      create: mocks.jobCreate,
      update: mocks.jobUpdate,
    },
    business: { count: mocks.businessCount },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { GET, PATCH, POST } from "../../src/app/api/import/route";

function controlRequest(action: string) {
  return new Request("http://localhost/api/import", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

describe("import route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleBox.role = "LEITOR";
  });

  it("refuses a viewer starting an import", async () => {
    const response = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "overpass", categories: ["padaria"] }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it.each(["pause", "resume", "cancel"])(
    "refuses a viewer sending %s",
    async (action) => {
      const response = await PATCH(controlRequest(action));

      expect(response.status).toBe(403);
      expect(mocks.jobUpdate).not.toHaveBeenCalled();
      expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
      expect(mocks.auditCreate).not.toHaveBeenCalled();
    },
  );

  it("lets a viewer read the import progress", async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.jobFindMany.mockResolvedValue([]);
    mocks.businessCount.mockResolvedValue(0);

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("lets an operator control an import", async () => {
    roleBox.role = "OPERADOR";
    mocks.jobFindFirst.mockResolvedValue(null);

    const response = await PATCH(controlRequest("pause"));

    // Not a refusal: the operator is allowed through and the handler decides.
    expect(response.status).not.toBe(403);
  });
});
