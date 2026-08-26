import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";
import { projectRow } from "../helpers/provisioning-fixtures";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

/**
 * Tables that remember, plus a transaction that actually rolls back.
 *
 * The behaviour under test is what survives a failed audit write, so a
 * `$transaction` that simply runs the callback would prove nothing: it has to
 * discard the writes when the callback throws, the way the real one does.
 */
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    repository: new Map<string, Row>(),
    hosting: new Map<string, Row>(),
    provisioning: new Map<string, Row>(),
  };
  const failAuditOn = { action: null as string | null };
  const audits: string[] = [];

  const snapshot = () => ({
    repository: new Map([...state.repository].map(([k, v]) => [k, { ...v }])),
    hosting: new Map([...state.hosting].map(([k, v]) => [k, { ...v }])),
    provisioning: new Map([...state.provisioning].map(([k, v]) => [k, { ...v }])),
  });

  const restore = (taken: ReturnType<typeof snapshot>) => {
    state.repository = taken.repository;
    state.hosting = taken.hosting;
    state.provisioning = taken.provisioning;
  };

  const upsertInto = (map: Map<string, Row>, defaults: Row) =>
    async ({ where, data }: { where: { siteProjectId: string }; data: Row }) => {
      const current = map.get(where.siteProjectId) ?? { ...defaults, ...where };
      const next = { ...current, ...data };
      map.set(where.siteProjectId, next);
      return next;
    };

  const client = {
    repository: {
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: "repository-1",
          externalId: null,
          url: null,
          defaultBranch: "main",
          creationStartedAt: null,
          protectedAt: null,
          ...data,
        };
        state.repository.set(String(data.siteProjectId), row);
        return row;
      },
      update: async (args: { where: { siteProjectId: string }; data: Row }) => {
        const current = state.repository.get(args.where.siteProjectId);
        if (!current) throw new Error("linha inexistente");
        const next = { ...current, ...args.data };
        state.repository.set(args.where.siteProjectId, next);
        return next;
      },
    },
    hostingProject: {
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: "hosting-1",
          externalId: null,
          url: null,
          creationStartedAt: null,
          linkedAt: null,
          ...data,
        };
        state.hosting.set(String(data.siteProjectId), row);
        return row;
      },
      update: async (args: { where: { siteProjectId: string }; data: Row }) => {
        const current = state.hosting.get(args.where.siteProjectId);
        if (!current) throw new Error("linha inexistente");
        const next = { ...current, ...args.data };
        state.hosting.set(args.where.siteProjectId, next);
        return next;
      },
    },
    siteProvisioning: {
      upsert: upsertInto(state.provisioning, { status: "PENDENTE" }),
      update: async (args: { where: { siteProjectId: string }; data: Row }) => {
        const current = state.provisioning.get(args.where.siteProjectId) ?? {
          ...args.where,
          status: "PENDENTE",
        };
        const next = { ...current, ...args.data };
        state.provisioning.set(args.where.siteProjectId, next);
        return next;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        const action = String(data.action);
        if (failAuditOn.action === action) {
          failAuditOn.action = null;
          throw new Error("falha proposital na auditoria");
        }
        audits.push(action);
        return data;
      },
    },
    user: { findUnique: async () => ({ id: "user-1" }) },
    secretRef: { findFirst: async () => null },
    appSettings: {
      findUnique: async () => ({
        brandName: "NOX OS",
        privacyEmail: "privacidade@noxos.test",
        updatedAt: new Date("2026-08-20T10:00:00.000Z"),
      }),
    },
    siteProject: { findFirst: vi.fn() },
  };

  return {
    state,
    audits,
    failAuditOn,
    client,
    reset() {
      state.repository.clear();
      state.hosting.clear();
      state.provisioning.clear();
      audits.length = 0;
      failAuditOn.action = null;
    },
    prisma: {
      ...client,
      // Rolls back on throw, which is the whole point.
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const taken = snapshot();
        const auditsBefore = audits.length;
        try {
          return await run(client);
        } catch (error) {
          restore(taken);
          audits.length = auditsBefore;
          throw error;
        }
      },
    },
  };
});

vi.mock("@/lib/integrations/settings-service", () => ({
  getEffectiveMode: async () => modeBox.mode,
}));
vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

const { provisionRepository } = await import("../../src/lib/provisioning/step-repository");
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

/** Feeds the service the rows the previous steps actually left behind. */
function refresh() {
  db.client.siteProject.findFirst.mockResolvedValue(
    projectRow({
      repository: db.state.repository.get("project-1") ?? null,
      hostingProject: db.state.hosting.get("project-1") ?? null,
      provisioning: db.state.provisioning.get("project-1") ?? null,
    }),
  );
}

function status(): string | undefined {
  return db.state.provisioning.get("project-1")?.status as string | undefined;
}

function countOf(action: string): number {
  return db.audits.filter((entry) => entry === action).length;
}

describe("a failing audit write rolls the local completion back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    db.reset();
    modeBox.mode = "FALSO";
    refresh();
  });

  it("step 1: the repository stays unfinished, then the retry completes it once", async () => {
    db.failAuditOn.action = "provisioning.repository.protect";

    await expect(
      provisionRepository({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toThrow(/auditoria/);

    // The remote repository exists — that effect is allowed to survive. What
    // must not survive is this side claiming to be done.
    expect(sharedFakeWorld.repositories.size).toBe(1);
    expect(db.state.repository.get("project-1")!.protectedAt).toBeNull();
    expect(db.audits).toEqual([]);
    // Failure is recorded, but it is not a dead end.
    expect(status()).toBe("FALHOU");

    refresh();
    const resumed = await provisionRepository({ actor: admin, siteProjectId: "project-1" });

    expect(resumed.repository.protectedAt).toBeInstanceOf(Date);
    expect(status()).toBe("REPOSITORIO_PRONTO");
    // No second repository, and each mandatory event exactly once.
    expect(sharedFakeWorld.repositories.size).toBe(1);
    expect(countOf("provisioning.repository.reconcile")).toBe(1);
    expect(countOf("provisioning.repository.protect")).toBe(1);
    expect(countOf("provisioning.repository.create")).toBe(0);
  });

  it("step 2: no second commit, and the event lands once", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });
    refresh();

    db.failAuditOn.action = "provisioning.content.commit";
    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toThrow(/auditoria/);

    const repo = [...sharedFakeWorld.repositories.values()][0];
    expect(repo.commits).toHaveLength(1);
    expect(db.state.provisioning.get("project-1")!.commitSha).toBeUndefined();
    expect(status()).toBe("FALHOU");

    refresh();
    const resumed = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // The content is identical, so the provider reports the same commit.
    expect(repo.commits).toHaveLength(1);
    expect(resumed.commitSha).toBe(repo.commits[0].sha);
    expect(status()).toBe("CONTEUDO_PRONTO");
    expect(countOf("provisioning.content.commit")).toBe(1);
  });

  it("step 3: no second project, and the event lands once", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });
    refresh();
    await provisionContent({ actor: admin, siteProjectId: "project-1" });
    refresh();

    db.failAuditOn.action = "provisioning.hosting.create";
    await expect(
      provisionHosting({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toThrow(/auditoria/);

    expect(sharedFakeWorld.projects.size).toBe(1);
    expect(db.state.hosting.get("project-1")!.linkedAt).toBeNull();
    expect(status()).toBe("FALHOU");

    refresh();
    const resumed = await provisionHosting({ actor: admin, siteProjectId: "project-1" });

    expect(resumed.hosting.linkedAt).toBeInstanceOf(Date);
    expect(sharedFakeWorld.projects.size).toBe(1);
    expect(status()).toBe("HOSPEDAGEM_PRONTA");
    expect(countOf("provisioning.hosting.reconcile")).toBe(1);
    expect(countOf("provisioning.hosting.create")).toBe(0);
  });

  it("step 4: the reconciliation is not recorded, then the retry records it once", async () => {
    await provisionRepository({ actor: admin, siteProjectId: "project-1" });
    refresh();
    await provisionContent({ actor: admin, siteProjectId: "project-1" });
    refresh();
    await provisionHosting({ actor: admin, siteProjectId: "project-1" });
    refresh();

    db.failAuditOn.action = "provisioning.preview.reconcile";
    await expect(
      reconcilePreview({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toThrow(/auditoria/);

    expect(db.state.provisioning.get("project-1")!.previewCheckedAt).toBeUndefined();
    expect(status()).toBe("FALHOU");

    refresh();
    const resumed = await reconcilePreview({ actor: admin, siteProjectId: "project-1" });

    expect(resumed.pending).toBe(false);
    expect(status()).toBe("PREVIA_RECONCILIADA");
    expect(countOf("provisioning.preview.reconcile")).toBe(1);
  });

  it("leaves no step permanently failed once the whole ladder is retried", async () => {
    for (const action of [
      "provisioning.repository.protect",
      "provisioning.content.commit",
      "provisioning.hosting.create",
      "provisioning.preview.reconcile",
    ]) {
      db.failAuditOn.action = action;
      const step =
        action.includes("repository")
          ? provisionRepository
          : action.includes("content")
            ? provisionContent
            : action.includes("hosting")
              ? provisionHosting
              : reconcilePreview;

      await step({ actor: admin, siteProjectId: "project-1" }).catch(() => null);
      refresh();
      await step({ actor: admin, siteProjectId: "project-1" });
      refresh();
    }

    expect(status()).toBe("PREVIA_RECONCILIADA");
    expect(db.state.provisioning.get("project-1")!.lastError).toBeNull();
    expect(sharedFakeWorld.repositories.size).toBe(1);
    expect(sharedFakeWorld.projects.size).toBe(1);
    expect([...sharedFakeWorld.repositories.values()][0].commits).toHaveLength(1);
  });
});
