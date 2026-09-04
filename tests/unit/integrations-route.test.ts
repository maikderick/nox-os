import { beforeEach, describe, expect, it, vi } from "vitest";

const roleBox = vi.hoisted(() => ({
  role: "ADMIN" as "OWNER" | "ADMIN" | "OPERADOR" | "LEITOR",
}));

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  settingFindMany: vi.fn(),
  settingFindUnique: vi.fn(),
  settingUpsert: vi.fn(),
  secretFindMany: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/authz/dal", async () => {
  const { dalMock } = await import("../helpers/authz-mock");
  return dalMock(roleBox);
});
vi.mock("@/lib/db", () => ({
  prisma: {
    // The real client hands the callback a transaction-bound client; the same
    // stubs stand in for it, so a test can assert both writes happened inside
    // one call.
    $transaction: mocks.transaction,
    integrationSetting: {
      findMany: mocks.settingFindMany,
      findUnique: mocks.settingFindUnique,
      upsert: mocks.settingUpsert,
    },
    secretRef: { findMany: mocks.secretFindMany },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { GET, PATCH } from "../../src/app/api/organizations/integrations/route";

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/organizations/integrations", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("integrations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleBox.role = "ADMIN";
    mocks.transaction.mockImplementation(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          integrationSetting: {
            findUnique: mocks.settingFindUnique,
            upsert: mocks.settingUpsert,
          },
          auditLog: { create: mocks.auditCreate },
          user: { findUnique: mocks.userFindUnique },
        }),
    );
    mocks.settingFindMany.mockResolvedValue([]);
    mocks.settingFindUnique.mockResolvedValue(null);
    mocks.settingUpsert.mockResolvedValue({});
    mocks.secretFindMany.mockResolvedValue([]);
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    delete process.env.NOX_INTEGRATIONS;
  });

  it("reports every provider as off when nothing is stored", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      integrations: Array<{ provider: string; effectiveMode: string }>;
    };
    expect(payload.integrations.map((i) => i.provider)).toEqual(["github", "vercel", "cursor"]);
    expect(payload.integrations.every((i) => i.effectiveMode === "DESLIGADO")).toBe(true);
  });

  it("refuses LIVE with a conflict, and writes nothing", async () => {
    const response = await PATCH(patchRequest({ provider: "github", mode: "LIVE" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MODO_INDISPONIVEL" });
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("accepts a mode that does not touch the network, and audits it", async () => {
    const response = await PATCH(patchRequest({ provider: "github", mode: "FALSO" }));

    expect(response.status).toBe(200);
    expect(mocks.settingUpsert).toHaveBeenCalledOnce();
    // One transaction, holding both writes.
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("integration.mode.update");
    expect(String(audited.metaJson)).toContain('"from":"DESLIGADO"');
    expect(String(audited.metaJson)).toContain('"to":"FALSO"');
  });

  it("refuses an operator changing a mode", async () => {
    roleBox.role = "OPERADOR";

    const response = await PATCH(patchRequest({ provider: "github", mode: "FALSO" }));

    expect(response.status).toBe(403);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("lets a viewer read the state but never change it", async () => {
    roleBox.role = "LEITOR";

    // Reading exposes modes and whether a variable is set — never a value.
    const read = await GET();
    expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).not.toMatch(/BEGIN |ghp_|ghs_/);

    const write = await PATCH(patchRequest({ provider: "github", mode: "FALSO" }));
    expect(write.status).toBe(403);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("rolls the mode change back when its audit entry fails", async () => {
    // The audit write throws inside the transaction, so nothing commits. A mode
    // change with no trace is exactly what the transaction exists to prevent.
    mocks.auditCreate.mockRejectedValueOnce(new Error("falha proposital na auditoria"));

    await expect(
      PATCH(patchRequest({ provider: "github", mode: "FALSO" })),
    ).rejects.toThrow(/auditoria/);

    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it.each(["FALSO", "SANDBOX"])(
    "now accepts %s for Cursor, whose queue and ledger exist",
    async (mode) => {
      // Cursor was refused every mode until the durable queue and the credit
      // ledger existed, because an agent without either is unbounded, unbilled
      // spend. Both exist now, so it is an integration like the others.
      const response = await PATCH(patchRequest({ provider: "cursor", mode }));

      expect(response.status).toBe(200);
      expect(mocks.settingUpsert).toHaveBeenCalled();
      expect(mocks.auditCreate).toHaveBeenCalled();
    },
  );

  it("still refuses LIVE for Cursor, as for every other provider", async () => {
    const response = await PATCH(patchRequest({ provider: "cursor", mode: "LIVE" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MODO_INDISPONIVEL" });
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("still accepts turning Cursor off", async () => {
    const response = await PATCH(patchRequest({ provider: "cursor", mode: "DESLIGADO" }));
    expect(response.status).toBe(200);
  });

  it("reports no provider as pending, and none offering LIVE", async () => {
    const payload = (await (await GET()).json()) as {
      integrations: Array<{ provider: string; pendingPhase: boolean; availableModes: string[] }>;
    };

    for (const integration of payload.integrations) {
      expect(integration.pendingPhase).toBe(false);
      expect(integration.availableModes).toEqual(["DESLIGADO", "FALSO", "SANDBOX"]);
    }
  });

  it("reads a stored Cursor mode as itself, now that the mode is available", async () => {
    mocks.settingFindMany.mockResolvedValue([{ provider: "cursor", mode: "FALSO" }]);

    const payload = (await (await GET()).json()) as {
      integrations: Array<{ provider: string; effectiveMode: string }>;
    };

    expect(payload.integrations.find((i) => i.provider === "cursor")?.effectiveMode).toBe(
      "FALSO",
    );
  });

  it("still reads a stored LIVE as off, for Cursor as for anything else", async () => {
    mocks.settingFindMany.mockResolvedValue([{ provider: "cursor", mode: "LIVE" }]);

    const payload = (await (await GET()).json()) as {
      integrations: Array<{ provider: string; effectiveMode: string }>;
    };

    expect(payload.integrations.find((i) => i.provider === "cursor")?.effectiveMode).toBe(
      "DESLIGADO",
    );
  });

  it("rejects an unknown provider before touching the database", async () => {
    const response = await PATCH(patchRequest({ provider: "railway", mode: "FALSO" }));

    expect(response.status).toBe(400);
    expect(mocks.settingUpsert).not.toHaveBeenCalled();
  });

  it("shows a stored mode as overridden when the environment forces off", async () => {
    process.env.NOX_INTEGRATIONS = "disabled";
    mocks.settingFindMany.mockResolvedValue([{ provider: "github", mode: "FALSO" }]);

    const response = await GET();
    const payload = (await response.json()) as {
      integrations: Array<{
        provider: string;
        storedMode: string;
        effectiveMode: string;
        forcedOffByEnvironment: boolean;
      }>;
    };
    const github = payload.integrations.find((i) => i.provider === "github");

    expect(github).toMatchObject({
      storedMode: "FALSO",
      effectiveMode: "DESLIGADO",
      forcedOffByEnvironment: true,
    });
  });
});
