import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import { REPO_ROW as REPO, projectRow } from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

/** A `HostingProject` table that remembers, so a partial run is observable. */
const store = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const failures = {
    create: 0,
    updateWhen: null as null | ((data: Record<string, unknown>) => boolean),
  };
  return {
    rows,
    failures,
    reset() {
      rows.clear();
      failures.create = 0;
      failures.updateWhen = null;
    },
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (failures.create > 0) {
        failures.create -= 1;
        throw new Error("falha proposital ao gravar a intenção");
      }
      const row = {
        id: "hosting-1",
        externalId: null,
        url: null,
        creationStartedAt: null,
        linkedAt: null,
        ...data,
      };
      rows.set(String(data.siteProjectId), row);
      return row;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { siteProjectId: string };
        data: Record<string, unknown>;
      }) => {
        if (failures.updateWhen?.(data)) {
          failures.updateWhen = null;
          throw new Error("falha proposital ao gravar o resultado");
        }
        const current = rows.get(where.siteProjectId);
        if (!current) throw new Error("linha inexistente");
        const next = { ...current, ...data };
        rows.set(where.siteProjectId, next);
        return next;
      },
    ),
  };
});

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
    // The real client hands the callback a transaction-bound client; the same
    // stubs stand in for it.
    $transaction: async (run: (client: unknown) => Promise<unknown>) =>
      run({
        hostingProject: { update: store.update },
        siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
        auditLog: { create: mocks.auditCreate },
        user: { findUnique: mocks.userFindUnique },
      }),
    siteProject: { findFirst: mocks.projectFindFirst },
    hostingProject: { create: store.create, update: store.update },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { isHostingComplete, provisionHosting } = await import(
  "../../src/lib/provisioning/step-hosting"
);
const { createFakeGitRepositoryProvider } = await import(
  "../../src/lib/providers/fake/fake-git"
);
const { createFakeHostingProvider } = await import(
  "../../src/lib/providers/fake/fake-hosting"
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

const failFinalWrite = (data: Record<string, unknown>) => "linkedAt" in data;

/** Step 3 runs after step 2, so the fixtures carry a published snapshot. */
const PUBLISHED = { contentSha256: "a".repeat(64), commitSha: "b".repeat(40) };

function refreshProject() {
  mocks.projectFindFirst.mockResolvedValue(
    projectRow({
      repository: REPO,
      provisioning: PUBLISHED,
      hostingProject: store.rows.get("project-1") ?? null,
    }),
  );
}

function auditedActions(): string[] {
  return mocks.auditCreate.mock.calls.map(
    (call) => (call[0].data as { action: string }).action,
  );
}

describe("provisioning step 3 — hosting", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    store.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({ repository: REPO, provisioning: PUBLISHED }),
    );
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });

    await createFakeGitRepositoryProvider({ world: sharedFakeWorld }).createFromTemplate({
      owner: REPO.owner,
      name: REPO.name,
      templateOwner: "maikderick",
      templateRepo: "nox-site-template",
    });
  });

  it("only counts as complete when it is linked", () => {
    expect(isHostingComplete(null)).toBe(false);
    expect(
      isHostingComplete({
        name: "n",
        externalId: null,
        url: null,
        creationStartedAt: new Date(),
        linkedAt: null,
      }),
    ).toBe(false);
    expect(
      isHostingComplete({
        name: "n",
        externalId: "prj",
        url: null,
        creationStartedAt: new Date(),
        linkedAt: null,
      }),
    ).toBe(false);
    expect(
      isHostingComplete({
        name: "n",
        externalId: "prj",
        url: null,
        creationStartedAt: new Date(),
        linkedAt: new Date(),
      }),
    ).toBe(true);
  });

  it("refuses before the repository exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: null, provisioning: PUBLISHED }));

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "REPOSITORIO_INCOMPLETO" });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("refuses when the installation cannot see the repository, before writing intent", async () => {
    sharedFakeWorld.hideFromHosting(REPO.owner, REPO.name);

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO" });

    expect(store.create).not.toHaveBeenCalled();
    expect(sharedFakeWorld.projects.size).toBe(0);

    const failure = mocks.provUpdate.mock.calls.at(-1)?.[0].data as Record<string, unknown>;
    expect(failure.status).toBe("FALHOU");
    expect(String(failure.lastError)).toContain("Autorize o repositório");
  });

  it("creates the project and binds identifiers, never secrets", async () => {
    const result = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(result).toMatchObject({ alreadyDone: false, reconciled: false });
    expect(result.hosting.name).toBe("site-oficina");
    expect(result.hosting.linkedAt).toBeInstanceOf(Date);

    const project = [...sharedFakeWorld.projects.values()][0];
    expect([...project.envVars.keys()]).toEqual(["NOX_SITE_PROJECT_ID"]);
    expect(project.envVars.get("NOX_SITE_PROJECT_ID")?.value).toBe("project-1");
  });

  it("is safe to repeat once linked", async () => {
    await provisionHosting({ actor: admin, siteProjectId: "project-1" });
    refreshProject();
    store.create.mockClear();

    const second = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(store.create).not.toHaveBeenCalled();
  });

  describe("resuming after a partial failure", () => {
    it("finishes when the project was created remotely but never recorded", async () => {
      store.failures.updateWhen = failFinalWrite;

      await expect(
        provisionHosting({ actor: admin, siteProjectId: "project-1" }),
      ).rejects.toMatchObject({ code: "ERRO_INESPERADO" });

      expect(sharedFakeWorld.projects.size).toBe(1);
      const stranded = store.rows.get("project-1")!;
      expect(stranded.linkedAt).toBeNull();
      expect(stranded.creationStartedAt).toBeInstanceOf(Date);

      refreshProject();
      const resumed = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

      expect(resumed).toMatchObject({ alreadyDone: false, reconciled: true });
      expect(resumed.hosting.externalId).toBeTruthy();
      expect(resumed.hosting.linkedAt).toBeInstanceOf(Date);
      // Still one project: the second pass adopted the first.
      expect(sharedFakeWorld.projects.size).toBe(1);
    });

    it("records the resumption as a reconciliation", async () => {
      store.failures.updateWhen = failFinalWrite;
      await provisionHosting({ actor: admin, siteProjectId: "project-1" }).catch(() => null);
      refreshProject();
      mocks.auditCreate.mockClear();

      await provisionHosting({ actor: admin, siteProjectId: "project-1" });

      expect(auditedActions()).toEqual(["provisioning.hosting.reconcile"]);
    });

    it("creates the project when the interruption happened before the remote call", async () => {
      await store.create({
        data: {
          siteProjectId: "project-1",
          organizationId: "org-1",
          provider: "vercel",
          name: "site-oficina",
        },
      });
      refreshProject();

      const result = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

      expect(result).toMatchObject({ alreadyDone: false, reconciled: false });
      expect(sharedFakeWorld.projects.size).toBe(1);
    });
  });

  it("refuses a homonymous project wired to another repository", async () => {
    // The attempt happened and a project with that name exists — but it builds
    // from somebody else. Applying variables to it is a live misconfiguration
    // on a site that is not ours.
    store.failures.updateWhen = failFinalWrite;
    await provisionHosting({ actor: admin, siteProjectId: "project-1" }).catch(() => null);

    const project = [...sharedFakeWorld.projects.values()][0];
    project.repoKey = "outra-pessoa/outro-repo";
    project.envVars.clear();
    refreshProject();
    mocks.auditCreate.mockClear();

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "HOSPEDAGEM_VINCULADA_A_OUTRO_REPOSITORIO" });

    // No variables were applied to the stranger, and nothing was audited.
    expect(project.envVars.size).toBe(0);
    expect(auditedActions()).toEqual([]);
    expect(store.rows.get("project-1")!.linkedAt).toBeNull();
  });

  it("resumes when the project provably came from the previous attempt", async () => {
    store.failures.updateWhen = failFinalWrite;
    await provisionHosting({ actor: admin, siteProjectId: "project-1" }).catch(() => null);
    refreshProject();

    const resumed = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(resumed).toMatchObject({ alreadyDone: false, reconciled: true });
    expect(sharedFakeWorld.projects.size).toBe(1);
  });

  it("refuses to adopt a hosting project the factory never created", async () => {
    await store.create({
      data: {
        siteProjectId: "project-1",
        organizationId: "org-1",
        provider: "vercel",
        name: "site-oficina",
      },
    });
    refreshProject();

    const repo = await createFakeGitRepositoryProvider({
      world: sharedFakeWorld,
    }).getRepository({ owner: REPO.owner, name: REPO.name });
    await createFakeHostingProvider({ world: sharedFakeWorld }).createProject({
      name: "site-oficina",
      repo: repo!,
    });

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "RECURSO_DE_TERCEIRO" });
  });

  it("refuses while the hosting integration is off", async () => {
    modeBox.mode = "DESLIGADO";

    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("audits the creation with the repository it was bound to", async () => {
    await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("provisioning.hosting.create");
    expect(String(audited.metaJson)).toContain("nox-sites-falso/site-oficina");
  });
});
