import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import {
  BRIEF_V2_INPUT,
  REPO_ROW as REPO,
  briefVersionRow,
  fact,
  projectRow,
} from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  settingsFindUnique: vi.fn(),
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
    // The real client hands the callback a transaction-bound client; the same
    // stubs stand in for it.
    $transaction: async (run: (client: unknown) => Promise<unknown>) =>
      run({
        siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
        auditLog: { create: mocks.auditCreate },
        user: { findUnique: mocks.userFindUnique },
      }),
    siteProject: { findFirst: mocks.projectFindFirst },
    appSettings: { findUnique: mocks.settingsFindUnique },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { CONTENT_PATH, MANIFEST_PATH, provisionContent } = await import(
  "../../src/lib/provisioning/step-content"
);
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



async function seedRepository() {
  const git = createFakeGitRepositoryProvider({ world: sharedFakeWorld });
  await git.createFromTemplate({
    owner: REPO.owner,
    name: REPO.name,
    templateOwner: "maikderick",
    templateRepo: "nox-site-template",
  });
}

describe("provisioning step 2 — content", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: REPO }));
    mocks.settingsFindUnique.mockResolvedValue({
      brandName: "NOX OS",
      privacyEmail: "privacidade@noxos.test",
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    await seedRepository();
  });

  it("refuses before the repository exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: null }));

    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "REPOSITORIO_INCOMPLETO" });
  });

  it("refuses before a briefing exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ repository: REPO, currentBriefVersion: null }),
    );

    // The eligibility gate speaks first now, and it is more specific.
    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "PROJETO_NAO_ELEGIVEL" });
  });

  it("commits the snapshot and the manifest, and records the sha", async () => {
    const result = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(result.alreadyDone).toBe(false);
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);

    const repo = [...sharedFakeWorld.repositories.values()][0];
    expect(repo.files.has(CONTENT_PATH)).toBe(true);
    expect(repo.files.has(MANIFEST_PATH)).toBe(true);
    expect(repo.commits).toHaveLength(1);
  });

  it("uses only the everyday App", async () => {
    sharedFakeWorld.credentialCalls.length = 0;
    await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(sharedFakeWorld.credentialCalls).toEqual(["reconciler"]);
    expect(sharedFakeWorld.credentialCalls).not.toContain("provisioner");
  });

  it("produces the same bytes on a second run, so nothing is recommitted", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // The provisioning row now remembers what was committed.
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        repository: REPO,
        provisioning: { contentSha256: first.contentSha256, commitSha: first.commitSha },
      }),
    );

    const second = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(second.commitSha).toBe(first.commitSha);
    expect([...sharedFakeWorld.repositories.values()][0].commits).toHaveLength(1);
  });

  it("does not depend on the clock", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // A fresh world and a fresh run of the same stored data must produce the
    // same fingerprint; a manifest carrying "now" would break this.
    sharedFakeWorld.reset();
    await seedRepository();
    const again = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(again.contentSha256).toBe(first.contentSha256);
    expect(again.commitSha).toBe(first.commitSha);
  });

  it("commits again when the briefing changes", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        repository: REPO,
        provisioning: { contentSha256: first.contentSha256, commitSha: first.commitSha },
        // The changed field has to be one the snapshot publishes. `objective`
        // was used here until it stopped reaching the site at all — it is an
        // answer about the job, not copy — and a brief whose only change is
        // internal *correctly* produces the same content and no new commit.
        currentBriefVersion: briefVersionRow(
          {
            ...BRIEF_V2_INPUT,
            about: fact("A oficina atende reparos hidráulicos e elétricos na região central."),
          },
          { version: 3, createdAt: new Date("2026-08-25T16:00:00.000Z") },
        ),
      }),
    );

    const second = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(false);
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect([...sharedFakeWorld.repositories.values()][0].commits).toHaveLength(2);
  });

  it("does not commit twice when the provider committed and the local write failed", async () => {
    // The remote/local window for step 2: the commit landed on the host and
    // this side never recorded it.
    mocks.provUpdate.mockRejectedValueOnce(new Error("falha proposital ao gravar o resultado"));

    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "ERRO_INESPERADO" });

    const repo = [...sharedFakeWorld.repositories.values()][0];
    expect(repo.commits).toHaveLength(1);
    const strandedSha = repo.commits[0].sha;

    // Press again with the provisioning row still empty, as it would be.
    const resumed = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // Identical content, so the provider reports the same commit and creates no
    // second one. Idempotence lives in the content, not in our bookkeeping.
    expect(resumed.commitSha).toBe(strandedSha);
    expect(repo.commits).toHaveLength(1);
    expect(resumed.alreadyDone).toBe(false);
  });

  it("audits the commit without carrying content", async () => {
    await provisionContent({ actor: admin, siteProjectId: "project-1" });

    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("provisioning.content.commit");
    expect(String(audited.metaJson)).toContain('"briefVersion":2');
    expect(String(audited.metaJson)).not.toContain("Oficina Demonstração");
  });
});
