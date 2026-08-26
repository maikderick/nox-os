import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import {
  allowedTransitionsFor,
  isStagePendingOrchestrator,
  SITE_PROJECT_ERROR_CODES,
  SiteProjectStageUnavailableError,
  STAGES_PENDING_ORCHESTRATOR,
} from "../../src/lib/site-factory/states";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { siteProject: { findFirst: mocks.findFirst, update: mocks.update } },
}));

const { transitionSiteProject } = await import("../../src/lib/site-factory/project-service");

const owner = {
  userId: "user-1",
  email: "dono@noxos.local",
  name: "Dono",
  organizationId: "org-1",
  organizationSlug: "nox-os",
  organizationName: "NOX OS",
  membershipId: "membership-1",
  role: "OWNER" as const,
  permissions: permissionsForRole("OWNER"),
};

describe("stages without an orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({ id: "project-1" });
  });

  it("names generation and publishing as the stages still pending", () => {
    expect([...STAGES_PENDING_ORCHESTRATOR]).toEqual(["GERANDO", "PUBLICANDO"]);
    expect(isStagePendingOrchestrator("GERANDO")).toBe(true);
    expect(isStagePendingOrchestrator("PUBLICANDO")).toBe(true);
    expect(isStagePendingOrchestrator("EM_REVISAO")).toBe(false);
  });

  it("never offers an unavailable stage as an action, not even to an owner", () => {
    const permissions = permissionsForRole("OWNER");
    for (const state of ["BRIEFING_PRONTO", "PREVIA_PRONTA", "EM_REVISAO", "APROVADO", "PUBLICADO", "FALHOU"] as const) {
      const targets = allowedTransitionsFor(state, permissions).map((transition) => transition.to);
      expect(targets).not.toContain("GERANDO");
      expect(targets).not.toContain("PUBLICANDO");
    }
  });

  it("still offers the stages that do work", () => {
    const targets = allowedTransitionsFor("EM_REVISAO", permissionsForRole("ADMIN")).map((t) => t.to);
    expect(targets).toContain("APROVADO");
    expect(targets).toContain("BRIEFING_PRONTO");
  });

  it("refuses BRIEFING_PRONTO to GERANDO without touching the database", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "BRIEFING_PRONTO" });

    await expect(
      transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "GERANDO" }),
    ).rejects.toBeInstanceOf(SiteProjectStageUnavailableError);

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses APROVADO to PUBLICANDO without touching the database", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "APROVADO" });

    await expect(
      transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "PUBLICANDO" }),
    ).rejects.toBeInstanceOf(SiteProjectStageUnavailableError);

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("carries a stable code and the refused state", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "BRIEFING_PRONTO" });

    const error = await transitionSiteProject({
      actor: owner,
      siteProjectId: "project-1",
      to: "GERANDO",
    }).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      code: SITE_PROJECT_ERROR_CODES.stageUnavailable,
      state: "GERANDO",
    });
  });

  it("lets an available transition through", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "EM_REVISAO" });

    await transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "APROVADO" });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { status: "APROVADO", statusMessage: null },
    });
  });
});
