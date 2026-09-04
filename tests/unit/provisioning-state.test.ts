import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole, roleHasPermission } from "../../src/lib/authz/permissions";

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  provUpsert: vi.fn(),
  provUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    siteProject: { findFirst: mocks.projectFindFirst },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
  },
}));

const {
  PROVISIONING_STATUSES,
  getProvisioning,
  recordStepFailure,
  recordStepSuccess,
} = await import("../../src/lib/provisioning/state");

const actor = {
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

describe("provisioning permissions", () => {
  it("lets an operator watch but never run", () => {
    expect(roleHasPermission("OPERADOR", "provisioning:read")).toBe(true);
    expect(roleHasPermission("OPERADOR", "provisioning:run")).toBe(false);
    expect(roleHasPermission("OPERADOR", "integration:manage")).toBe(false);
  });

  it("gives an administrator both", () => {
    expect(roleHasPermission("ADMIN", "provisioning:read")).toBe(true);
    expect(roleHasPermission("ADMIN", "provisioning:run")).toBe(true);
  });

  it("gives a viewer neither", () => {
    expect(permissionsForRole("LEITOR")).not.toContain("provisioning:read");
    expect(permissionsForRole("LEITOR")).not.toContain("provisioning:run");
  });
});

describe("provisioning state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockImplementation(async (args: { data: unknown }) => args.data);
  });

  it("names the whole resumable ladder", () => {
    expect([...PROVISIONING_STATUSES]).toEqual([
      "PENDENTE",
      "REPOSITORIO_PRONTO",
      "CONTEUDO_PRONTO",
      "HOSPEDAGEM_PRONTA",
      "PREVIA_RECONCILIADA",
      "FALHOU",
    ]);
  });

  it("hides another organization's project behind the same refusal as a missing one", async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(getProvisioning(actor, "project-de-outra-org")).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-de-outra-org", organizationId: "org-1" },
      }),
    );
  });

  it("advances the status and clears the previous error on success", async () => {
    const data = await recordStepSuccess({
      siteProjectId: "project-1",
      step: "repository",
    });

    expect(data).toMatchObject({
      status: "REPOSITORIO_PRONTO",
      lastStep: "repository",
      lastError: null,
    });
  });

  it("stores nothing of an error it did not build, and hands the description back", async () => {
    const leak =
      "GitHub respondeu 401 para Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz012345";
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(...args);
    });

    let stored;
    try {
      stored = await recordStepFailure({
        siteProjectId: "project-1",
        step: "repository",
        error: new Error(leak),
      });
    } finally {
      spy.mockRestore();
    }

    // The caller gets the same description that reached the column, so the
    // exception it raises next carries one correlation id, not a second one.
    expect(stored.code).toBe("ERRO_INESPERADO");
    expect(stored.correlationId).toMatch(/^[0-9a-f-]{36}$/);

    const written = mocks.provUpdate.mock.calls.at(-1)![0].data as {
      status: string;
      lastError: string;
    };
    expect(written.status).toBe("FALHOU");
    expect(written.lastError).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
    expect(written.lastError).toContain(stored.correlationId!);
    expect(JSON.stringify(logged)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
  });

  it("stores the message it rebuilds from a closed reason", async () => {
    const { ProvisioningRefusal, buildReasonMessage } = await import(
      "../../src/lib/provisioning/reasons"
    );

    const stored = await recordStepFailure({
      siteProjectId: "project-1",
      step: "hosting",
      error: new ProvisioningRefusal("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO", {
        owner: "nox-sites",
        repository: "site-oficina",
      }),
    });

    const expected = buildReasonMessage("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO", {
      owner: "nox-sites",
      repository: "site-oficina",
    });

    // A known refusal needs no correlation id: it travels as itself.
    expect(stored).toMatchObject({ message: expected });
    expect(stored.correlationId).toBeUndefined();

    const written = mocks.provUpdate.mock.calls.at(-1)![0].data as { lastError: string };
    expect(written.lastError).toBe(expected);
  });
});
