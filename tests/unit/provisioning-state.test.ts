import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole, roleHasPermission } from "../../src/lib/authz/permissions";
import { redactProviderError } from "../../src/lib/providers/errors";

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

  it("redacts a provider error before storing it", async () => {
    const leak =
      "GitHub respondeu 401 para Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz012345";

    const data = (await recordStepFailure({
      siteProjectId: "project-1",
      step: "repository",
      error: new Error(leak),
    })) as unknown as { status: string; lastError: string };

    expect(data.status).toBe("FALHOU");
    expect(data.lastError).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
    expect(data.lastError).toContain("[redigido]");
  });
});

describe("error redaction", () => {
  it("removes tokens, keys and authorization headers", () => {
    expect(redactProviderError("token ghp_abcdefghijklmnopqrstuvwxyz012345")).not.toContain("ghp_");
    expect(
      redactProviderError(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
      ),
    ).toBe("[redigido]");
    expect(redactProviderError("Authorization: Bearer abcdefghijklmnop")).not.toContain(
      "abcdefghijklmnop",
    );
  });

  it("keeps an ordinary message readable", () => {
    expect(redactProviderError("O repositório já existe.")).toBe("O repositório já existe.");
  });

  it("caps the length so a huge body never lands in a column", () => {
    expect(redactProviderError("x".repeat(5000)).length).toBeLessThanOrEqual(501);
  });
});
