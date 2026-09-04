import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import {
  allowedTransitionsFor,
  isStagePendingOrchestrator,
  isStageRequestedNotTransitioned,
  SITE_PROJECT_ERROR_CODES,
  SiteProjectStageNotTransitionableError,
  SiteProjectStageUnavailableError,
  SiteProjectTransitionError,
  STAGES_PENDING_ORCHESTRATOR,
  STAGES_REQUESTED_NOT_TRANSITIONED,
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

describe("stages a person may not transition into", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({ id: "project-1" });
  });

  it("names publishing as the only stage still pending", () => {
    // `GERANDO` left this list when the queue arrived: something now creates
    // the run, calls the agent and reports the transition back out.
    expect([...STAGES_PENDING_ORCHESTRATOR]).toEqual(["PUBLICANDO"]);
    expect(isStagePendingOrchestrator("PUBLICANDO")).toBe(true);
    expect(isStagePendingOrchestrator("GERANDO")).toBe(false);
    expect(isStagePendingOrchestrator("EM_REVISAO")).toBe(false);
  });

  it("names generation as asked for, never transitioned into", () => {
    expect([...STAGES_REQUESTED_NOT_TRANSITIONED]).toEqual(["GERANDO"]);
    expect(isStageRequestedNotTransitioned("GERANDO")).toBe(true);
    expect(isStageRequestedNotTransitioned("PUBLICANDO")).toBe(false);
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

    // A plain status change would leave the project in `GERANDO` with no run,
    // no reservation and no job — and the only way out of `GERANDO` is a system
    // transition reported by the run that would not exist.
    await expect(
      transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "GERANDO" }),
    ).rejects.toBeInstanceOf(SiteProjectStageNotTransitionableError);

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
      code: SITE_PROJECT_ERROR_CODES.stageNotTransitionable,
      state: "GERANDO",
    });
  });

  it("offers the deterministic release from BRIEFING_PRONTO, never the agent stage", () => {
    const targets = allowedTransitionsFor("BRIEFING_PRONTO", permissionsForRole("OPERADOR")).map(
      (transition) => transition.to,
    );
    expect(targets).toContain("PREVIA_PRONTA");
    // `GERANDO` is asked for through its own route, and stays out of the
    // generic transition control however the table grows.
    expect(targets).not.toContain("GERANDO");
  });

  it("moves BRIEFING_PRONTO to PREVIA_PRONTA and writes it", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "BRIEFING_PRONTO" });

    await transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "PREVIA_PRONTA" });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { status: "PREVIA_PRONTA", statusMessage: null },
    });
  });

  it("continua recusando o salto de BRIEFING_PRONTO para APROVADO", async () => {
    mocks.findFirst.mockResolvedValue({ id: "project-1", status: "BRIEFING_PRONTO" });

    await expect(
      transitionSiteProject({ actor: owner, siteProjectId: "project-1", to: "APROVADO" }),
    ).rejects.toBeInstanceOf(SiteProjectTransitionError);

    expect(mocks.update).not.toHaveBeenCalled();
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
