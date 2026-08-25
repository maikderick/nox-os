import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "../../src/app/api/demo-landings/route";

describe("legacy DemoLanding creation", () => {
  beforeEach(() => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    delete process.env.ALLOW_LEGACY_DEMO_LANDING_CREATION;
  });

  it("returns gone unless the compatibility flag is explicit", async () => {
    const response = await POST(new Request("http://localhost/api/demo-landings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId: "lead-1", expiresInDays: 14 }),
    }));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "demo_landing_deprecated" });
  });
});
