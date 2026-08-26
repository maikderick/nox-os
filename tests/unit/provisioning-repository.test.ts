import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import { projectRow } from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

/**
 * A stand-in for the `Repository` table.
 *
 * The resume behaviour is about what survives a crash between a remote call and
 * a local write, so the test needs a table that actually remembers — a bare
 * `vi.fn()` could not tell "started" from "finished".
 */
const store = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  // Which write to break. The step writes twice: a checkpoint before the remote
  // call, and the result after it — the two windows have to be testable apart.
  const failures = { create: 0, updateWhen: null as null | ((data: Record<string, unknown>) => boolean) };
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
        id: "repository-1",
        externalId: null,
        url: null,
        defaultBranch: "main",
        creationStartedAt: null,
        protectedAt: null,
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
    repository: { create: store.create, update: store.update },
    secretRef: { findFirst: mocks.secretFindFirst },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { isRepositoryComplete, provisionRepository } = await import(
  "../../src/lib/provisioning/step-repository"
);
const { createFakeGitRepositoryProvider } = await import(
  "../../src/lib/providers/fake/fake-git"
);

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

const row = (overrides: Record<string, unknown> = {}) => ({
  owner: "o",
  name: "n",
  url: null,
  externalId: null,
  defaultBranch: "main",
  creationStartedAt: null,
  protectedAt: null,
  ...overrides,
});

/** Re-reads the project the way the service will on the next call. */
function refreshProject() {
  mocks.projectFindFirst.mockResolvedValue(
    projectRow({ repository: store.rows.get("project-1") ?? null }),
  );
}

function auditedActions(): string[] {
  return mocks.auditCreate.mock.calls.map(
    (call) => (call[0].data as { action: string }).action,
  );
}

describe("provisioning step 1 — repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    store.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(projectRow());
    mocks.secretFindFirst.mockResolvedValue(null);
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
  });

  it("only counts as complete when both halves landed", () => {
    expect(isRepositoryComplete(null)).toBe(false);
    expect(isRepositoryComplete(row({ creationStartedAt: new Date() }))).toBe(false);
    expect(isRepositoryComplete(row({ externalId: "1" }))).toBe(false);
    expect(isRepositoryComplete(row({ protectedAt: new Date() }))).toBe(false);
    expect(isRepositoryComplete(row({ externalId: "1", protectedAt: new Date() }))).toBe(true);
  });

  it("refuses while the integration is off, and creates nothing", async () => {
    modeBox.mode = "DESLIGADO";

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "INTEGRACAO_DESLIGADA" });

    expect(store.create).not.toHaveBeenCalled();
    expect(sharedFakeWorld.repositories.size).toBe(0);
  });

  it("refuses an operator, who may watch but not run", async () => {
    await expect(
      provisionRepository({ actor: actorWith("OPERADOR"), siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ status: 403 });

    expect(store.create).not.toHaveBeenCalled();
  });

  it("records the intention before anything remote happens", async () => {
    store.failures.create = 1;

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toThrow(/intenção/);

    // Nothing remote was attempted, which is the point of writing it first.
    expect(sharedFakeWorld.repositories.size).toBe(0);
    expect(sharedFakeWorld.credentialCalls).toEqual([]);
  });

  it("creates the repository and protects it with verify only", async () => {
    const result = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(result).toMatchObject({ alreadyDone: false, reconciled: false });
    expect(result.repository.name).toBe("site-oficina");
    expect(result.repository.externalId).toBeTruthy();
    expect(result.repository.protectedAt).toBeInstanceOf(Date);

    expect([...sharedFakeWorld.repositories.values()][0].protectedChecks).toEqual(["verify"]);
  });

  it("records creating and protecting as separate events", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(auditedActions()).toEqual([
      "provisioning.repository.create",
      "provisioning.repository.protect",
    ]);
    const protect = mocks.auditCreate.mock.calls[1][0].data as Record<string, unknown>;
    expect(String(protect.metaJson)).toContain('"requiredChecks":["verify"]');
  });

  it("uses the privileged App only to create and protect", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(sharedFakeWorld.credentialCalls).toEqual([
      "reconciler", // looking the repository up is everyday work
      "provisioner", // creating is not
      "provisioner", // neither is protecting
    ]);
  });

  it("is safe to repeat once finished", async () => {
    const first = await provisionRepository({ actor: admin, siteProjectId: "project-1" });
    refreshProject();
    store.create.mockClear();
    mocks.auditCreate.mockClear();

    const second = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(second.repository.externalId).toBe(first.repository.externalId);
    expect(store.create).not.toHaveBeenCalled();
    expect(auditedActions()).toEqual([]);
  });

  describe("resuming after a partial failure", () => {
    it("finishes when the remote creation succeeded but the local write did not", async () => {
      // The dangerous window: the repository now exists on the host and this
      // side never found out.
      store.failures.updateWhen = (data) => "protectedAt" in data;
      await expect(
        provisionRepository({ actor: admin, siteProjectId: "project-1" }),
      ).rejects.toThrow(/resultado/);

      expect(sharedFakeWorld.repositories.size).toBe(1);
      const stranded = store.rows.get("project-1")!;
      expect(stranded.externalId).toBeNull();
      expect(stranded.creationStartedAt).toBeInstanceOf(Date);

      // Press again. No rename, no manual delete.
      refreshProject();
      const resumed = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

      expect(resumed).toMatchObject({ alreadyDone: false, reconciled: true });
      expect(resumed.repository.externalId).toBeTruthy();
      expect(resumed.repository.protectedAt).toBeInstanceOf(Date);
      // Still exactly one repository: the second pass adopted the first.
      expect(sharedFakeWorld.repositories.size).toBe(1);
    });

    it("records the resumption as a reconciliation, not as a creation", async () => {
      store.failures.updateWhen = (data) => "protectedAt" in data;
      await provisionRepository({ actor: admin, siteProjectId: "project-1" }).catch(() => null);
      refreshProject();
      mocks.auditCreate.mockClear();

      await provisionRepository({ actor: admin, siteProjectId: "project-1" });

      expect(auditedActions()).toEqual([
        "provisioning.repository.reconcile",
        "provisioning.repository.protect",
      ]);
    });

    it("creates the repository when the interruption happened before the remote call", async () => {
      await store.create({
        data: {
          siteProjectId: "project-1",
          organizationId: "org-1",
          provider: "github",
          owner: "nox-sites-falso",
          name: "site-oficina",
        },
      });
      refreshProject();

      const result = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

      expect(result).toMatchObject({ alreadyDone: false, reconciled: false });
      expect(sharedFakeWorld.repositories.size).toBe(1);
    });

    it("protects a repository that was created but never protected", async () => {
      store.failures.updateWhen = (data) => "protectedAt" in data;
      await provisionRepository({ actor: admin, siteProjectId: "project-1" }).catch(() => null);
      [...sharedFakeWorld.repositories.values()][0].protectedChecks = null;
      refreshProject();

      await provisionRepository({ actor: admin, siteProjectId: "project-1" });

      expect([...sharedFakeWorld.repositories.values()][0].protectedChecks).toEqual(["verify"]);
    });
  });

  it("refuses to adopt a repository the factory never created", async () => {
    // The name is taken, and there is no record of us ever trying.
    await store.create({
      data: {
        siteProjectId: "project-1",
        organizationId: "org-1",
        provider: "github",
        owner: "nox-sites-falso",
        name: "site-oficina",
      },
    });
    refreshProject();
    await createFakeGitRepositoryProvider({ world: sharedFakeWorld }).createFromTemplate({
      owner: "nox-sites-falso",
      name: "site-oficina",
      templateOwner: "outro",
      templateRepo: "outro",
    });

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "RECURSO_DE_TERCEIRO" });

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
