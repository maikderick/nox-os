import { beforeEach, describe, expect, it, vi } from "vitest";

const roleBox = vi.hoisted(() => ({
  role: "OPERADOR" as "ADMIN" | "OPERADOR" | "LEITOR",
}));

vi.mock("@/lib/authz/dal", async () => {
  const { dalMock } = await import("../helpers/authz-mock");
  return dalMock(roleBox);
});
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "../../src/app/api/demo-landings/route";

function createRequest() {
  return new Request("http://localhost/api/demo-landings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: "lead-1", expiresInDays: 14 }),
  });
}

describe("legacy DemoLanding creation", () => {
  beforeEach(() => {
    roleBox.role = "OPERADOR";
    delete process.env.ALLOW_LEGACY_DEMO_LANDING_CREATION;
  });

  it("returns gone unless the compatibility flag is explicit", async () => {
    const response = await POST(createRequest());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "demo_landing_deprecated" });
  });

  it("refuses a viewer before deciding about the compatibility flag", async () => {
    roleBox.role = "LEITOR";

    const response = await POST(createRequest());

    // 403, not 410: the refusal is about the caller, not about the feature.
    expect(response.status).toBe(403);
  });
});
