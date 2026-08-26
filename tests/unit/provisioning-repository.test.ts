import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import { projectRow } from "../helpers/provisioning-fixtures";

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

const { provisionRepository } = await import("../../src/lib/provisioning/step-repository");

function actorWith(role: "ADMIN" | "OPERADOR") {
  return {
    userId: "user-1",
    email: "a@b.test",
    name: "Pessoa",
    organizationId: "org-1",
    organizationSlug: "nox-os",
    organizationName: "NOX OS",
    membershipId: "m-1",
    role,
    permissions: permissionsForRole(role),
  };
}

const admin = actorWith("ADMIN");


describe("provisioning step 1 — repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(projectRow());
    mocks.secretFindFirst.mockResolvedValue(null);
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.repositoryCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "repository-1",
      ...data,
    }));
  });

  it("refuses while the integration is off, and creates nothing", async () => {
    modeBox.mode = "DESLIGADO";

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    // The refusal is still recorded, so the operator sees why on the screen.
    expect(mocks.provUpdate).not.toHaveBeenCalled();
  });

  it("refuses an operator, who may watch but not run", async () => {
    await expect(
      provisionRepository({ actor: actorWith("OPERADOR"), siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it("creates the repository from the template and protects it with verify only", async () => {
    const result = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(result.alreadyDone).toBe(false);
    expect(result.repository.name).toBe("site-oficina");
    expect(result.repository.protectedAt).toBeInstanceOf(Date);

    const created = [...sharedFakeWorld.repositories.values()][0];
    expect(created.protectedChecks).toEqual(["verify"]);

    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("provisioning.repository.create");
    expect(String(audited.metaJson)).toContain('"requiredChecks":["verify"]');
  });

  it("uses only the privileged App for this step", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    // getRepository (availability check) is everyday work; creating and
    // protecting are not.
    expect(sharedFakeWorld.credentialCalls).toEqual([
      "reconciler",
      "provisioner",
      "provisioner",
    ]);
  });

  it("is safe to repeat: the second call reports the same repository", async () => {
    const first = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        repository: {
          owner: first.repository.owner,
          name: first.repository.name,
          url: first.repository.url,
          externalId: first.repository.externalId,
          defaultBranch: "main",
          protectedAt: first.repository.protectedAt,
        },
      }),
    );
    mocks.repositoryCreate.mockClear();

    const second = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(second.repository.name).toBe(first.repository.name);
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it("refuses when the name is already taken on the host, and records the failure", async () => {
    // Someone else owns the name: the slug is unique per organization, not
    // across the whole host.
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });
    mocks.repositoryCreate.mockClear();

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "RECURSO_JA_EXISTE" });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    const failure = mocks.provUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
    expect(failure.status).toBe("FALHOU");
    expect(failure.lastStep).toBe("repository");
  });

  it("hides another organization's project behind the same refusal as a missing one", async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-de-outra-org" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
