import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import {
  contentIsPublished,
  hostingIsReady,
  repositoryIsReady,
  runnableSteps,
} from "../../src/lib/provisioning/step-order";
import { REPO_ROW, projectRow } from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  repositoryCreate: vi.fn(),
  repositoryUpdate: vi.fn(),
  hostingCreate: vi.fn(),
  hostingUpdate: vi.fn(),
  provUpsert: vi.fn(),
  provUpdate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  settingsFindUnique: vi.fn(),
  secretFindFirst: vi.fn(),
}));

vi.mock("@/lib/integrations/settings-service", () => ({
  getEffectiveMode: async () => modeBox.mode,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        repository: { update: mocks.repositoryUpdate },
        hostingProject: { update: mocks.hostingUpdate },
        siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
        auditLog: { create: mocks.auditCreate },
        user: { findUnique: mocks.userFindUnique },
      }),
    siteProject: { findFirst: mocks.projectFindFirst },
    repository: { create: mocks.repositoryCreate, update: mocks.repositoryUpdate },
    hostingProject: { create: mocks.hostingCreate, update: mocks.hostingUpdate },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    appSettings: { findUnique: mocks.settingsFindUnique },
    secretRef: { findFirst: mocks.secretFindFirst },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { provisionContent } = await import("../../src/lib/provisioning/step-content");
const { provisionHosting } = await import("../../src/lib/provisioning/step-hosting");
const { reconcilePreview } = await import("../../src/lib/provisioning/step-preview");

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

/** A repository row that exists locally but never finished. */
const STARTED_REPO = {
  ...REPO_ROW,
  externalId: null,
  protectedAt: null,
};

const PROTECTED_ONLY = { ...REPO_ROW, externalId: null };
const CREATED_ONLY = { ...REPO_ROW, protectedAt: null };

const STARTED_HOSTING = {
  name: "site-oficina",
  externalId: null,
  url: null,
  creationStartedAt: new Date("2026-08-25T15:18:00.000Z"),
  linkedAt: null,
};

const LINKED_HOSTING = {
  name: "site-oficina",
  externalId: "prj_1",
  url: "https://site-oficina.vercel.example",
  creationStartedAt: new Date("2026-08-25T15:18:00.000Z"),
  linkedAt: new Date("2026-08-25T15:20:00.000Z"),
};

const PUBLISHED = { contentSha256: "a".repeat(64), commitSha: "b".repeat(40) };

describe("what counts as ready", () => {
  it("needs both halves of a repository", () => {
    expect(repositoryIsReady(null)).toBe(false);
    expect(repositoryIsReady(STARTED_REPO)).toBe(false);
    expect(repositoryIsReady(CREATED_ONLY)).toBe(false);
    expect(repositoryIsReady(PROTECTED_ONLY)).toBe(false);
    expect(repositoryIsReady(REPO_ROW)).toBe(true);
  });

  it("needs both fingerprints of a publication", () => {
    expect(contentIsPublished(null)).toBe(false);
    expect(contentIsPublished({ contentSha256: "a", commitSha: null })).toBe(false);
    expect(contentIsPublished({ contentSha256: null, commitSha: "b" })).toBe(false);
    expect(contentIsPublished(PUBLISHED)).toBe(true);
  });

  it("needs the hosting project to be linked", () => {
    expect(hostingIsReady(null)).toBe(false);
    expect(hostingIsReady(STARTED_HOSTING)).toBe(false);
    expect(hostingIsReady(LINKED_HOSTING)).toBe(true);
  });

  it("offers each step only once its predecessor landed", () => {
    const empty = runnableSteps({ repository: null, hostingProject: null, provisioning: null });
    expect(empty).toEqual({
      repository: true,
      content: false,
      hosting: false,
      "reconcile-preview": false,
    });

    expect(
      runnableSteps({ repository: REPO_ROW, hostingProject: null, provisioning: null }),
    ).toMatchObject({ content: true, hosting: false, "reconcile-preview": false });

    expect(
      runnableSteps({ repository: REPO_ROW, hostingProject: null, provisioning: PUBLISHED }),
    ).toMatchObject({ hosting: true, "reconcile-preview": false });

    expect(
      runnableSteps({
        repository: REPO_ROW,
        hostingProject: LINKED_HOSTING,
        provisioning: PUBLISHED,
      }),
    ).toMatchObject({ "reconcile-preview": true });
  });
});

describe("the API refuses out-of-order calls, whatever the screen shows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.secretFindFirst.mockResolvedValue(null);
    mocks.settingsFindUnique.mockResolvedValue({
      brandName: "NOX OS",
      privacyEmail: "privacidade@noxos.test",
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    });
  });

  /** No provider was reached: nothing was created, no credential resolved. */
  function expectNoProviderTouched() {
    expect(sharedFakeWorld.repositories.size).toBe(0);
    expect(sharedFakeWorld.projects.size).toBe(0);
    expect(sharedFakeWorld.credentialCalls).toEqual([]);
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    expect(mocks.hostingCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  }

  it.each([
    ["nenhum repositório", null],
    ["intenção registrada, nada criado", STARTED_REPO],
    ["criado, nunca protegido", CREATED_ONLY],
    ["protegido, sem id remoto", PROTECTED_ONLY],
  ])("content: refuses with %s", async (_label, repository) => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository }));

    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "REPOSITORIO_INCOMPLETO" });

    expectNoProviderTouched();
  });

  it.each([
    ["nenhum repositório", null, null],
    ["repositório incompleto", STARTED_REPO, PUBLISHED],
  ])("hosting: refuses with %s", async (_label, repository, provisioning) => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository, provisioning }));

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "REPOSITORIO_INCOMPLETO" });

    expectNoProviderTouched();
  });

  it.each([
    ["conteúdo nunca publicado", null],
    ["só o sha do conteúdo", { contentSha256: "a".repeat(64), commitSha: null }],
    ["só o commit", { contentSha256: null, commitSha: "b".repeat(40) }],
  ])("hosting: refuses when the content is not published — %s", async (_label, provisioning) => {
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ repository: REPO_ROW, provisioning }),
    );

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "CONTEUDO_NAO_PUBLICADO" });

    expectNoProviderTouched();
  });

  it.each([
    ["nenhuma hospedagem", null],
    ["intenção registrada, nunca ligada", STARTED_HOSTING],
  ])("reconcile-preview: refuses with %s", async (_label, hostingProject) => {
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ repository: REPO_ROW, hostingProject, provisioning: PUBLISHED }),
    );

    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "HOSPEDAGEM_INCOMPLETA" });

    expectNoProviderTouched();
  });

  it("reconcile-preview: refuses when the hosting is linked but nothing was committed", async () => {
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        repository: REPO_ROW,
        hostingProject: LINKED_HOSTING,
        provisioning: { contentSha256: "a".repeat(64), commitSha: null },
      }),
    );

    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "CONTEUDO_NAO_PUBLICADO" });

    expectNoProviderTouched();
  });
});
