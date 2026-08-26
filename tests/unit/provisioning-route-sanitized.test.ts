import { beforeEach, describe, expect, it, vi } from "vitest";

import { REPO_ROW, projectRow } from "../helpers/provisioning-fixtures";

/**
 * The last mile: what leaves the HTTP boundary.
 *
 * Everything else is already proved elsewhere — the column, the audit row, the
 * log line. This exercises the real route handler, because the path that used to
 * leak was the one nobody wrote: `throw error` handing the original object to
 * Next, which logs its message and its stack whatever the database holds.
 */

const LEAKS: Array<[string, string]> = [
  [
    "github fine-grained",
    "401 github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdef",
  ],
  ["github classic", "bad credentials ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
  ["vercel", 'GET /v9/projects 403 {"token":"AbCdEf0123456789GhIjKlMnOpQr"}'],
  ["anthropic", "invalid x-api-key sk-ant-api03-AbCdEf-0123456789_GhIjKlMnOpQrStUvWxYz"],
  ["cookie", "set-cookie _vercel_jwt=eyJhbGciOi.eyJzdWIiOi.QWxhZGRpbjpvcGVu HttpOnly"],
  [
    "private key",
    "-----BEGIN RSA PRIVATE KEY----- MIIEowIBAAKCAQEA0Z3VS5JJcds3 -----END RSA PRIVATE KEY-----",
  ],
  ["formato desconhecido", "provider said <<<XYZ-9f3a::7712::segredo-de-formato-novo>>>"],
];

function fragments(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part.length > 12);
}

const boxes = vi.hoisted(() => ({
  mode: { value: "FALSO" as string },
  /** What the provider throws when the route reaches it. */
  providerThrows: { error: null as unknown },
  /** What loading the project throws, to fail before `runStep` ever runs. */
  loadThrows: { error: null as unknown },
  console: [] as unknown[],
}));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  repositoryCreate: vi.fn(),
  repositoryUpdate: vi.fn(),
  provUpsert: vi.fn(),
  provUpdate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  secretFindFirst: vi.fn(),
}));

vi.mock("@/lib/authz/dal", async () => {
  const { permissionsForRole: roles } = await import("@/lib/authz/permissions");
  return {
    requireActor: async () => ({
      userId: "user-1",
      email: "a@b.test",
      name: "Pessoa",
      organizationId: "org-1",
      organizationSlug: "nox-os",
      organizationName: "NOX OS",
      membershipId: "m-1",
      role: "ADMIN" as const,
      permissions: roles("ADMIN"),
    }),
    assertPermission: () => {},
    requirePermission: async () => ({}),
  };
});

vi.mock("@/lib/integrations/settings-service", () => ({
  getEffectiveMode: async () => boxes.mode.value,
}));

vi.mock("@/lib/providers/registry", () => ({
  getGitRepositoryProvider: () => ({
    id: "github",
    mode: "FALSO",
    isConfigured: async () => true,
    getRepository: async () => {
      if (boxes.providerThrows.error) throw boxes.providerThrows.error;
      return null;
    },
    createFromTemplate: async () => {
      throw new Error("não deveria chegar aqui");
    },
    protectDefaultBranch: async () => {},
    commitFiles: async () => ({ sha: "x", url: null }),
  }),
  getHostingProvider: () => ({}),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        repository: { update: mocks.repositoryUpdate },
        siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
        auditLog: { create: mocks.auditCreate },
        user: { findUnique: mocks.userFindUnique },
      }),
    siteProject: {
      findFirst: async (...args: unknown[]) => {
        if (boxes.loadThrows.error) throw boxes.loadThrows.error;
        return mocks.projectFindFirst(...args);
      },
    },
    repository: { create: mocks.repositoryCreate, update: mocks.repositoryUpdate },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    secretRef: { findFirst: mocks.secretFindFirst },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { POST } = await import(
  "../../src/app/api/projects/[id]/provision/repository/route"
);

const ctx = { params: Promise.resolve({ id: "project-1" }) };
const request = () =>
  new Request("http://localhost/api/projects/project-1/provision/repository", {
    method: "POST",
  });

/** Everything the failure could have been written into. */
function everythingWritten(): string {
  return JSON.stringify({
    provisioning: mocks.provUpdate.mock.calls,
    audits: mocks.auditCreate.mock.calls,
    console: boxes.console,
  });
}

describe("the HTTP boundary never lets an original error out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boxes.mode.value = "FALSO";
    boxes.providerThrows.error = null;
    boxes.loadThrows.error = null;
    boxes.console.length = 0;

    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      boxes.console.push(...args);
    });

    mocks.projectFindFirst.mockResolvedValue(projectRow());
    mocks.secretFindFirst.mockResolvedValue(null);
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.repositoryCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "repository-1",
      externalId: null,
      url: null,
      defaultBranch: "main",
      creationStartedAt: null,
      protectedAt: null,
      ...data,
    }));
  });

  describe.each(LEAKS)("a provider throwing %s", (_label, raw) => {
    it("answers 500 with a safe message and a correlation id, and never rejects", async () => {
      boxes.providerThrows.error = new Error(raw);

      // The handler resolves. If it rejected, Next would log the original.
      const response = await POST(request(), ctx);

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(500);

      const payload = (await (response as Response).json()) as {
        error: string;
        code: string;
        correlationId: string;
      };

      expect(payload.code).toBe("ERRO_INESPERADO");
      expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      for (const fragment of fragments(raw)) {
        expect(payload.error).not.toContain(fragment);
        expect(JSON.stringify(payload)).not.toContain(fragment);
      }
    });

    it("leaves no fragment in the database, the audit trail or the console", async () => {
      boxes.providerThrows.error = new Error(raw);
      await POST(request(), ctx);

      const written = everythingWritten();
      for (const fragment of fragments(raw)) {
        expect(written).not.toContain(fragment);
      }
      expect(written).not.toContain(raw);
      // The failure was recorded — safely.
      expect(mocks.provUpdate).toHaveBeenCalled();
      expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it("uses one correlation id for the response and the stored row", async () => {
      boxes.providerThrows.error = new Error(raw);
      const response = (await POST(request(), ctx)) as Response;
      const payload = (await response.json()) as { correlationId: string };

      const stored = String(
        (mocks.provUpdate.mock.calls.at(-1)![0] as { data: { lastError: string } }).data.lastError,
      );
      // Describing the failure twice would put a different id on the screen than
      // the one in the log.
      expect(stored).toContain(payload.correlationId);
    });
  });

  describe.each(LEAKS)("a failure before runStep carrying %s", (_label, raw) => {
    it("gets the same protection", async () => {
      boxes.loadThrows.error = new Error(raw);

      const response = (await POST(request(), ctx)) as Response;

      expect(response.status).toBe(500);
      const payload = (await response.json()) as { code: string; correlationId: string };
      expect(payload.code).toBe("ERRO_INESPERADO");
      expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/);

      const written = everythingWritten() + JSON.stringify(payload);
      for (const fragment of fragments(raw)) {
        expect(written).not.toContain(fragment);
      }
      // Nothing was recorded, because no step was ever entered.
      expect(mocks.provUpdate).not.toHaveBeenCalled();
    });
  });

  it("keeps a known refusal on its own code and status", async () => {
    boxes.mode.value = "DESLIGADO";

    const response = (await POST(request(), ctx)) as Response;

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { code: string; correlationId?: string };
    expect(payload.code).toBe("INTEGRACAO_DESLIGADA");
    expect(payload.correlationId).toBeUndefined();
  });

  it("keeps an out-of-order refusal on 409 as well", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ status: "RASCUNHO" }));

    const response = (await POST(request(), ctx)) as Response;

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("PROJETO_NAO_ELEGIVEL");
  });

  it("still succeeds when nothing throws", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: REPO_ROW }));

    const response = (await POST(request(), ctx)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyDone: true });
  });
});

describe("the sanitized failure carries nothing of the original", () => {
  it("has no cause, no original name, message, stack or property", async () => {
    const { SanitizedProvisioningFailure } = await import(
      "../../src/lib/provisioning/error-record"
    );

    const original = Object.assign(new Error("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), {
      name: "OctokitRequestError",
      response: { headers: { authorization: "Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ" } },
    });

    const sanitized = new SanitizedProvisioningFailure(
      { code: "ERRO_INESPERADO", message: "mensagem genérica", correlationId: "abc-123" },
      "repository",
    );

    expect(sanitized.message).toBe("mensagem genérica");
    expect(sanitized.name).toBe("SanitizedProvisioningFailure");
    expect(sanitized.correlationId).toBe("abc-123");
    expect(sanitized.step).toBe("repository");
    expect((sanitized as { cause?: unknown }).cause).toBeUndefined();

    // Nothing of the original is reachable from it, by any path.
    const serialized = JSON.stringify({
      own: Object.getOwnPropertyNames(sanitized).map((key) => [
        key,
        String((sanitized as unknown as Record<string, unknown>)[key]),
      ]),
      stack: sanitized.stack,
    });
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("Octokit");
    expect(serialized).not.toContain(original.message);
  });
});
