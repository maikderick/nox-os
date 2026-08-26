import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole, type OrganizationRole } from "@/lib/authz/permissions";

const boxes = vi.hoisted(() => ({
  role: { value: "ADMIN" as OrganizationRole },
  signedIn: { value: true },
  batch: { calls: 0 },
}));

vi.mock("@/lib/authz/dal", async () => {
  const { permissionsForRole: forRole } = await import("@/lib/authz/permissions");
  const { AuthorizationError } = await import("@/lib/authz/errors");
  const { assertPermission } = await vi.importActual<typeof import("@/lib/authz/dal")>(
    "@/lib/authz/dal",
  );
  return {
    assertPermission,
    requireActor: async () => {
      if (!boxes.signedIn.value) throw AuthorizationError.unauthenticated();
      return {
        userId: "user-1",
        email: "a@b.test",
        name: "Pessoa",
        organizationId: "org-1",
        organizationSlug: "nox-os",
        organizationName: "NOX OS",
        membershipId: "m-1",
        role: boxes.role.value,
        permissions: forRole(boxes.role.value),
      };
    },
  };
});

vi.mock("@/lib/jobs/consumer", () => ({
  runJobBatch: async () => {
    boxes.batch.calls += 1;
    return {
      owner: "consumidor-teste",
      claimed: 0,
      outcomes: {},
      stoppedBecause: "sem_trabalho",
      elapsedMs: 1,
    };
  },
}));

const { POST, maxDuration } = await import("../../src/app/api/jobs/run/route");

const SECRET = "segredo-do-agendador-de-teste";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/jobs/run", { method: "POST", headers });
}

describe("who may wake the consumer", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    boxes.role.value = "ADMIN";
    boxes.signedIn.value = true;
    boxes.batch.calls = 0;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("gives the function room to answer after its budget", () => {
    // The lease is set above this on purpose; see `claim.ts`.
    expect(maxDuration).toBe(300);
  });

  it("is scheduled every minute, at the path it actually lives on", async () => {
    // A five-minute cron would make the thirty-second backoff decorative: the
    // shortest real wait would be five minutes whatever the queue asked for.
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons).toEqual([{ path: "/api/jobs/run", schedule: "* * * * *" }]);
  });

  describe("the scheduler", () => {
    it("runs a batch with the right credential", async () => {
      const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

      expect(response.status).toBe(200);
      expect(boxes.batch.calls).toBe(1);
    });

    it.each([
      ["wrong secret", "Bearer segredo-errado"],
      ["right secret, no scheme", SECRET.slice(0, -1)],
      ["empty", "Bearer "],
      ["a prefix of the real one", `Bearer ${SECRET.slice(0, 10)}`],
      ["the real one plus more", `Bearer ${SECRET}x`],
    ])("answers 401 to %s, and runs nothing", async (_label, authorization) => {
      const response = await POST(request({ authorization }));

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toBe(0);
    });

    it("does not fall back to the session check when the credential is wrong", async () => {
      // Falling back would answer 403 about permissions, which tells whoever is
      // probing that the secret was the wrong part.
      boxes.role.value = "LEITOR";

      const response = await POST(request({ authorization: "Bearer errado" }));

      expect(response.status).toBe(401);
    });

    it("refuses everything when no secret is configured", async () => {
      // A missing environment variable is the most ordinary deployment mistake
      // there is, and it must not turn this into an open endpoint.
      delete process.env.CRON_SECRET;

      const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toBe(0);
    });
  });

  describe("a person", () => {
    it("runs a batch when they hold `job:run`", async () => {
      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(boxes.batch.calls).toBe(1);
    });

    it("is refused with 403 without it, even holding `job:read`", async () => {
      boxes.role.value = "OPERADOR";
      expect(permissionsForRole("OPERADOR")).toContain("job:read");

      const response = await POST(request());

      expect(response.status).toBe(403);
      expect(boxes.batch.calls).toBe(0);
    });

    it("is refused with 401 when not signed in", async () => {
      boxes.signedIn.value = false;

      const response = await POST(request());

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toBe(0);
    });
  });
});
