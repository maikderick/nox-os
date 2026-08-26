import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  listProjects: vi.fn(),
  convert: vi.fn(),
  createProject: vi.fn(),
  createBrief: vi.fn(),
  createProjectWithBrief: vi.fn(),
}));

vi.mock("@/lib/authz/dal", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/site-factory/project-service", () => ({
  listSiteProjects: mocks.listProjects,
  createSiteProject: mocks.createProject,
}));
vi.mock("@/lib/site-factory/client-service", () => ({ convertBusinessToClient: mocks.convert }));
vi.mock("@/lib/site-factory/brief-service", () => ({ createSiteBriefVersion: mocks.createBrief }));
// The route delegates the whole submission to one unit of work; the transaction
// itself is covered against a real database in site-factory-db.test.ts.
vi.mock("@/lib/site-factory/project-intake", () => ({
  createProjectWithBrief: mocks.createProjectWithBrief,
}));

import { GET, POST } from "../../src/app/api/projects/route";

const actor = { userId: "user-1", organizationId: "org-1", role: "OPERADOR" };
const fact = (value: string) => ({ value, source: "OPERADOR", confirmedAt: "2026-08-25T12:00:00.000Z" });

function validPayload() {
  return {
    businessId: "lead-1",
    name: "Site Padaria Aurora",
    sector: "Padaria",
    brief: {
      businessName: fact("Padaria Aurora"),
      sector: fact("Padaria"),
      objective: fact("Apresentar o negócio."),
      audience: fact("Pessoas da região."),
      positioning: fact("Informações claras sobre o negócio."),
      desiredSections: ["Início", "Contato"],
      visualDirection: fact("Visual contemporâneo e legível."),
    },
  };
}

describe("projects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.listProjects.mockResolvedValue([]);
    mocks.convert.mockResolvedValue({ id: "client-1" });
    mocks.createProject.mockResolvedValue({ id: "project-1", status: "RASCUNHO" });
    mocks.createBrief.mockResolvedValue({ id: "brief-1", version: 1 });
    mocks.createProjectWithBrief.mockResolvedValue({
      client: { id: "client-1" },
      project: { id: "project-1", status: "BRIEFING_PRONTO", currentBriefVersionId: "brief-1" },
      briefVersion: { id: "brief-1", version: 1 },
    });
  });

  it("lists only after project read authorization", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith("project:read");
    expect(await response.json()).toEqual({ projects: [] });
  });

  it("creates client, project and first brief in one unit of work", async () => {
    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload()),
    }));
    expect(response.status).toBe(201);
    // One call, not three: the route no longer sequences the writes itself.
    expect(mocks.createProjectWithBrief).toHaveBeenCalledOnce();
    expect(mocks.createProjectWithBrief).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "lead-1", name: "Site Padaria Aurora" }),
    );
    expect(await response.json()).toMatchObject({
      project: { status: "BRIEFING_PRONTO" },
    });
  });

  it("rejects a malformed briefing before touching the database services", async () => {
    const response = await POST(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validPayload(), brief: { businessName: fact("X") } }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createProjectWithBrief).not.toHaveBeenCalled();
  });
});
