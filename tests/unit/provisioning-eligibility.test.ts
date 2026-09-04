import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { siteBriefSchema } from "../../src/lib/site-factory/brief-schema";
import { SITE_PROJECT_STATE_LABELS } from "../../src/lib/site-factory/states";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import {
  BRIEF_V1_INPUT,
  BRIEF_V2_INPUT,
  briefVersionRow,
  projectRow,
} from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  repositoryCreate: vi.fn(),
  secretFindFirst: vi.fn(),
  provUpsert: vi.fn(),
  provUpdate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/integrations/settings-service", () => ({
  getEffectiveMode: async () => modeBox.mode,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    siteProject: { findFirst: mocks.projectFindFirst },
    repository: { create: mocks.repositoryCreate },
    secretRef: { findFirst: mocks.secretFindFirst },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { ELIGIBILITY_CODES, assertProvisioningEligible } = await import(
  "../../src/lib/provisioning/eligibility"
);
const { provisionRepository } = await import("../../src/lib/provisioning/step-repository");

const admin = {
  userId: "user-1",
  email: "a@b.test",
  name: "Pessoa",
  organizationId: "org-1",
  organizationSlug: "nox-os",
  organizationName: "NOX OS",
  membershipId: "m-1",
  role: "ADMIN" as const,
  permissions: permissionsForRole("ADMIN"),
};

describe("the eligibility gate", () => {
  it("accepts a project ready to be provisioned", () => {
    const eligible = assertProvisioningEligible(projectRow());
    expect(eligible.version).toBe(2);
    expect(eligible.brief.schemaVersion).toBe(2);
  });

  it("refuses a draft", () => {
    // The refusal names the stage with the label the panel shows, read from
    // the state machine, so the operator can find it on screen.
    expect(() => assertProvisioningEligible(projectRow({ status: "RASCUNHO" }))).toThrow(
      new RegExp(SITE_PROJECT_STATE_LABELS.BRIEFING_PRONTO),
    );

    try {
      assertProvisioningEligible(projectRow({ status: "RASCUNHO" }));
    } catch (error) {
      expect(error).toMatchObject({ code: ELIGIBILITY_CODES.projectNotReady });
    }
  });

  it("refuses a project that already moved past the briefing", () => {
    for (const status of ["GERANDO", "APROVADO", "PUBLICADO", "FALHOU"]) {
      expect(() => assertProvisioningEligible(projectRow({ status }))).toThrow();
    }
  });

  it("refuses a v1 briefing, which cannot describe a service page", () => {
    const project = projectRow({ currentBriefVersion: briefVersionRow(BRIEF_V1_INPUT) });

    try {
      assertProvisioningEligible(project);
      throw new Error("deveria ter recusado");
    } catch (error) {
      expect(error).toMatchObject({ code: ELIGIBILITY_CODES.briefVersionTooOld });
    }
  });

  it("refuses content edited underneath its own fingerprint", () => {
    const honest = briefVersionRow(BRIEF_V2_INPUT);
    const tampered = {
      ...honest,
      // Same stored fingerprint, different stored facts.
      contentJson: JSON.stringify(
        siteBriefSchema.parse({
          ...BRIEF_V2_INPUT,
          businessName: {
            value: "Outra Empresa",
            source: "OPERADOR",
            confirmedAt: "2026-08-25T12:00:00.000-03:00",
          },
        }),
      ),
    };

    try {
      assertProvisioningEligible(projectRow({ currentBriefVersion: tampered }));
      throw new Error("deveria ter recusado");
    } catch (error) {
      expect(error).toMatchObject({ code: ELIGIBILITY_CODES.briefTampered });
    }
  });

  it("refuses content that no longer parses at all", () => {
    const broken = { ...briefVersionRow(), contentJson: "{ isto não é json" };

    try {
      assertProvisioningEligible(projectRow({ currentBriefVersion: broken }));
      throw new Error("deveria ter recusado");
    } catch (error) {
      expect(error).toMatchObject({ code: ELIGIBILITY_CODES.briefTampered });
    }
  });

  it("refuses a project with no current briefing", () => {
    expect(() => assertProvisioningEligible(projectRow({ currentBriefVersion: null }))).toThrow();
  });
});

describe("the gate runs before any provider is reached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.secretFindFirst.mockResolvedValue(null);
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
  });

  it.each([
    ["um rascunho", projectRow({ status: "RASCUNHO" })],
    ["um briefing v1", projectRow({ currentBriefVersion: briefVersionRow(BRIEF_V1_INPUT) })],
    [
      "um briefing adulterado",
      projectRow({
        currentBriefVersion: { ...briefVersionRow(), factsHash: "f".repeat(64) },
      }),
    ],
  ])("recusa %s sem tocar no provedor", async (_label, project) => {
    mocks.projectFindFirst.mockResolvedValue(project);

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toBeInstanceOf(Error);

    // No repository was created remotely, none was recorded, nothing was
    // audited, and no credential was ever resolved.
    expect(sharedFakeWorld.repositories.size).toBe(0);
    expect(sharedFakeWorld.credentialCalls).toEqual([]);
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
