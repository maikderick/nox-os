import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  hostingCreate: vi.fn(),
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
    hostingProject: { create: mocks.hostingCreate },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { provisionHosting } = await import("../../src/lib/provisioning/step-hosting");
const { createFakeGitRepositoryProvider } = await import(
  "../../src/lib/providers/fake/fake-git"
);

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

const REPO = {
  owner: "nox-sites-falso",
  name: "site-oficina",
  externalId: "repo_1",
  url: "https://github.example/nox-sites-falso/site-oficina",
  defaultBranch: "main",
};

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Site Oficina",
    slug: "site-oficina",
    client: { id: "client-1", name: "Oficina", slug: "oficina" },
    currentBriefVersion: null,
    repository: REPO,
    hostingProject: null,
    provisioning: null,
    ...overrides,
  };
}

describe("provisioning step 3 — hosting", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(projectRow());
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.hostingCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "hosting-1",
      ...data,
    }));

    await createFakeGitRepositoryProvider({ world: sharedFakeWorld }).createFromTemplate({
      owner: REPO.owner,
      name: REPO.name,
      templateOwner: "maikderick",
      templateRepo: "nox-site-template",
    });
  });

  it("refuses before the repository exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: null }));

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "PREFLIGHT_FALHOU" });
    expect(mocks.hostingCreate).not.toHaveBeenCalled();
  });

  it("refuses when the hosting installation cannot see the repository", async () => {
    sharedFakeWorld.hideFromHosting(REPO.owner, REPO.name);

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "PREFLIGHT_FALHOU" });

    // Nothing is created: a project pointing at an invisible repository never
    // builds, and the failure would surface far from its cause.
    expect(mocks.hostingCreate).not.toHaveBeenCalled();
    expect(sharedFakeWorld.projects.size).toBe(0);

    const failure = mocks.provUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
    expect(failure.status).toBe("FALHOU");
    expect(String(failure.lastError)).toContain("Autorize o repositório");
  });

  it("creates the project and binds identifiers, never secrets", async () => {
    const result = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(result.alreadyDone).toBe(false);
    expect(result.hosting.name).toBe("site-oficina");

    const project = [...sharedFakeWorld.projects.values()][0];
    expect([...project.envVars.keys()]).toEqual(["NOX_SITE_PROJECT_ID"]);
    expect(project.envVars.get("NOX_SITE_PROJECT_ID")?.value).toBe("project-1");
  });

  it("is safe to repeat", async () => {
    const first = await provisionHosting({ actor: admin, siteProjectId: "project-1" });
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        hostingProject: {
          name: first.hosting.name,
          externalId: first.hosting.externalId,
          url: first.hosting.url,
          linkedAt: first.hosting.linkedAt,
        },
      }),
    );
    mocks.hostingCreate.mockClear();

    const second = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(mocks.hostingCreate).not.toHaveBeenCalled();
  });

  it("refuses while the hosting integration is off", async () => {
    modeBox.mode = "DESLIGADO";

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });
    expect(mocks.hostingCreate).not.toHaveBeenCalled();
  });

  it("audits the creation with the repository it was bound to", async () => {
    await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("provisioning.hosting.create");
    expect(String(audited.metaJson)).toContain("nox-sites-falso/site-oficina");
  });
});
