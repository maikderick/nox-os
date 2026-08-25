import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  auditCount: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  improve: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/authz/dal", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/db", () => ({
  prisma: {
    demoLanding: { findUnique: mocks.findUnique, update: mocks.update },
    auditLog: { count: mocks.auditCount, create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return { ...actual, improveDemoLandingContent: mocks.improve };
});

import { DemoAiError } from "../../src/lib/anthropic";
import { AuthorizationError } from "../../src/lib/authz/errors";
import { generateDemoLandingContent } from "../../src/lib/demo-landing";
import { POST } from "../../src/app/api/demo-landings/[id]/improve/route";
import { PATCH } from "../../src/app/api/demo-landings/[id]/route";

const business = {
  name: "Padaria Aurora",
  category: "Padaria",
  address: "Rua Central, 10",
  neighborhood: "Centro",
  city: "Fortaleza",
  state: "CE",
  postalCode: "60000-000",
  phoneE164: "+5585999999999",
  socialLinks: "[]",
  website: null as string | null,
  latitude: -3.7319,
  longitude: -38.5267,
};

const content = generateDemoLandingContent({ ...business, website: null });

function storedLanding(overrides: Record<string, unknown> = {}) {
  return {
    id: "demo-1",
    businessId: "lead-1",
    slug: "padaria-aurora-abcdef123456",
    status: "DRAFT",
    contentJson: JSON.stringify(content),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user-1",
    business,
    ...overrides,
  };
}

const ctx = { params: Promise.resolve({ id: "demo-1" }) };

function improveRequest() {
  return new Request("http://localhost/api/demo-landings/demo-1/improve", { method: "POST" });
}

describe("POST /api/demo-landings/[id]/improve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    delete process.env.DEMO_AI_HOURLY_LIMIT;
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue(storedLanding());
    mocks.auditCount.mockResolvedValue(0);
    mocks.auditCreate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.improve.mockResolvedValue({
      content: { ...content, headline: "Conheça a Padaria Aurora" },
      changedFields: ["headline"],
      droppedServices: [],
      attempts: 1,
      model: "claude-opus-5",
    });
    mocks.requirePermission.mockResolvedValue({ userId: "user-1", role: "ADMIN" });
  });

  it("requires an authenticated user", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(improveRequest(), ctx);

    expect(response.status).toBe(401);
    expect(mocks.improve).not.toHaveBeenCalled();
  });

  it("explains the missing configuration instead of failing silently", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await POST(improveRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("not_configured");
    expect(body.error).toContain("ANTHROPIC_API_KEY");
    expect(mocks.improve).not.toHaveBeenCalled();
  });

  it("refuses leads that already have their own website", async () => {
    mocks.findUnique.mockResolvedValue(
      storedLanding({ business: { ...business, website: "https://padaria-aurora.com.br" } }),
    );

    const response = await POST(improveRequest(), ctx);

    expect(response.status).toBe(409);
    expect(mocks.improve).not.toHaveBeenCalled();
  });

  it("refuses expired demos", async () => {
    mocks.findUnique.mockResolvedValue(
      storedLanding({ expiresAt: new Date(Date.now() - 86_400_000) }),
    );

    const response = await POST(improveRequest(), ctx);

    expect(response.status).toBe(409);
    expect(mocks.improve).not.toHaveBeenCalled();
  });

  it("enforces the hourly usage limit before calling the API", async () => {
    process.env.DEMO_AI_HOURLY_LIMIT = "2";
    mocks.auditCount.mockResolvedValue(2);

    const response = await POST(improveRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.code).toBe("rate_limited");
    expect(mocks.improve).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("returns the suggestion for review without publishing anything", async () => {
    const response = await POST(improveRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.suggestion.changedFields).toEqual(["headline"]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2);
    const actions = mocks.auditCreate.mock.calls.map(
      (call) => (call[0] as { data: { action: string } }).data.action,
    );
    expect(actions).toEqual(["demo_landing.ai_requested", "demo_landing.ai_suggested"]);
  });

  it("keeps the demo unchanged and reports the failure code", async () => {
    mocks.improve.mockRejectedValue(new DemoAiError("timeout"));

    const response = await POST(improveRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.code).toBe("timeout");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not leak the API key in the response", async () => {
    mocks.improve.mockRejectedValue(new Error("401 x-api-key chave-de-teste inválida"));

    const response = await POST(improveRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("chave-de-teste");
  });
});

function patchRequest(payload: unknown) {
  return new Request("http://localhost/api/demo-landings/demo-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("PATCH approval state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.auditCreate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.findUnique.mockResolvedValue(
      storedLanding({ status: "APPROVED", approvedAt: new Date() }),
    );
    mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      storedLanding({
        status: data.status,
        approvedAt: data.approvedAt ?? null,
        contentJson: data.contentJson ?? JSON.stringify(content),
      }),
    );
    mocks.requirePermission.mockResolvedValue({ userId: "user-1", role: "ADMIN" });
  });

  it("sends an approved demo back to draft when the content changes", async () => {
    const response = await PATCH(
      patchRequest({ content: { ...content, headline: "Novo título" } }),
      ctx,
    );

    expect(response.status).toBe(200);
    const data = mocks.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("DRAFT");
    expect(data.approvedAt).toBeNull();
  });

  it("keeps the demo approved when the reviewer approves explicitly", async () => {
    const response = await PATCH(
      patchRequest({ content: { ...content, headline: "Novo título" }, status: "APPROVED" }),
      ctx,
    );

    expect(response.status).toBe(200);
    const data = mocks.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("APPROVED");
    expect(mocks.requirePermission).toHaveBeenCalledWith("publish:approve");
  });

  it("refuses approval when the actor lacks approval permission", async () => {
    mocks.requirePermission.mockRejectedValue(
      AuthorizationError.missingPermission("publish:approve"),
    );

    const response = await PATCH(patchRequest({ status: "APPROVED" }), ctx);
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
