import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import { REPO_ROW as REPO, projectRow as baseProjectRow } from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
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
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { chooseDeployment, reconcilePreview } = await import(
  "../../src/lib/provisioning/step-preview"
);
const { createFakeGitRepositoryProvider } = await import("../../src/lib/providers/fake/fake-git");
const { createFakeHostingProvider } = await import("../../src/lib/providers/fake/fake-hosting");

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


function projectRow(overrides: Record<string, unknown> = {}) {
  return baseProjectRow({
    repository: REPO,
    hostingProject: {
      name: "site-oficina",
      externalId: "prj_1",
      url: "https://site-oficina.vercel.example",
      linkedAt: new Date("2026-08-25T15:20:00.000Z"),
    },
    provisioning: { commitSha: null, contentSha256: null },
    ...overrides,
  });
}

/** Brings the fake world to "repository committed, project created". */
async function seedWorld() {
  const git = createFakeGitRepositoryProvider({ world: sharedFakeWorld });
  const repo = await git.createFromTemplate({
    owner: REPO.owner,
    name: REPO.name,
    templateOwner: "maikderick",
    templateRepo: "nox-site-template",
  });
  const commit = await git.commitFiles({
    repo,
    branch: "main",
    message: "conteúdo",
    files: [{ path: "content/site.json", content: '{"a":1}' }],
  });
  await createFakeHostingProvider({ world: sharedFakeWorld }).createProject({
    name: "site-oficina",
    repo,
  });
  return commit.sha;
}

describe("choosing which deployment speaks for a commit", () => {
  const at = (createdAt: string, state: string, externalId: string) => ({
    externalId,
    state,
    url: `https://${externalId}.test`,
    commitSha: "abc",
    createdAt,
  });

  it("returns nothing when there is nothing", () => {
    expect(chooseDeployment([])).toBeNull();
  });

  it("prefers the one an operator can actually open", () => {
    const chosen = chooseDeployment([
      at("2026-01-02T00:00:00Z", "ERROR", "b"),
      at("2026-01-01T00:00:00Z", "READY", "a"),
    ]);
    expect(chosen?.externalId).toBe("a");
  });

  it("falls back to the most recent attempt when none is ready", () => {
    const chosen = chooseDeployment([
      at("2026-01-01T00:00:00Z", "ERROR", "a"),
      at("2026-01-03T00:00:00Z", "BUILDING", "c"),
    ]);
    expect(chosen?.externalId).toBe("c");
  });
});

describe("provisioning step 4 — reconcile preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
  });

  it("refuses before the hosting project exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ hostingProject: null }));

    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "HOSPEDAGEM_INCOMPLETA" });
  });

  it("refuses when there is no commit to ask about", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow());

    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "CONTEUDO_NAO_PUBLICADO" });
  });

  it("asks the platform at that instant and records what it found", async () => {
    const sha = await seedWorld();
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ provisioning: { commitSha: sha, contentSha256: "x" } }),
    );

    const result = await reconcilePreview({ actor: admin, siteProjectId: "project-1" });

    expect(result.pending).toBe(false);
    expect(result.preview).toMatchObject({ state: "READY", commitSha: sha });
    expect(result.preview.url).toContain("vercel.example");

    const written = mocks.provUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
    expect(written.status).toBe("PREVIA_RECONCILIADA");
    expect(written.previewUrl).toBe(result.preview.url);
    expect(written.previewCheckedAt).toBeInstanceOf(Date);
  });

  it("treats a commit with no build yet as pending, not as a failure", async () => {
    await seedWorld();
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ provisioning: { commitSha: "0".repeat(40), contentSha256: "x" } }),
    );

    const result = await reconcilePreview({ actor: admin, siteProjectId: "project-1" });

    expect(result.pending).toBe(true);
    expect(result.preview.url).toBeNull();

    const written = mocks.provUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
    // It asked, and says so. The status is not FALHOU.
    expect(written.status).toBe("PREVIA_RECONCILIADA");
    expect(written.previewCheckedAt).toBeInstanceOf(Date);
  });

  it("is safe to repeat and keeps reporting the same preview", async () => {
    const sha = await seedWorld();
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ provisioning: { commitSha: sha, contentSha256: "x" } }),
    );

    const first = await reconcilePreview({ actor: admin, siteProjectId: "project-1" });
    const second = await reconcilePreview({ actor: admin, siteProjectId: "project-1" });

    expect(second.preview.externalId).toBe(first.preview.externalId);
    expect(second.preview.url).toBe(first.preview.url);
  });

  it("refuses while the hosting integration is off", async () => {
    modeBox.mode = "DESLIGADO";
    mocks.projectFindFirst.mockResolvedValue(projectRow());

    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });
  });
});
