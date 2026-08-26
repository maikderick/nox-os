import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole, type OrganizationRole } from "@/lib/authz/permissions";

const boxes = vi.hoisted(() => ({
  role: { value: "ADMIN" as OrganizationRole },
  signedIn: { value: true },
  batch: { calls: [] as Array<{ organizationId?: string }> },
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
        organizationId: "org-do-ator",
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
  runJobBatch: async (params: { organizationId?: string }) => {
    boxes.batch.calls.push({ organizationId: params.organizationId });
    return {
      owner: "consumidor-teste",
      organizationId: params.organizationId,
      reclaimed: 0,
      claimed: 0,
      outcomes: {},
      stoppedBecause: "sem_trabalho",
      elapsedMs: 1,
    };
  },
}));

const { GET, POST, maxDuration } = await import("../../src/app/api/jobs/run/route");

const SECRET = "segredo-do-agendador-de-teste";

function request(method: "GET" | "POST", headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/jobs/run", { method, headers });
}

describe("two doors, and neither opens the other", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    boxes.role.value = "ADMIN";
    boxes.signedIn.value = true;
    boxes.batch.calls = [];
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

  describe("GET — the scheduler, and only the scheduler", () => {
    it("works the global queue with the right credential", async () => {
      const response = await GET(request("GET", { authorization: `Bearer ${SECRET}` }));

      expect(response.status).toBe(200);
      // No organization: the scheduler serves every tenant, so there is nobody
      // for it to be scoped to.
      expect(boxes.batch.calls).toEqual([{ organizationId: undefined }]);
    });

    it("never lets an answer be cached", async () => {
      const response = await GET(request("GET", { authorization: `Bearer ${SECRET}` }));

      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it.each([
      ["a wrong secret", "Bearer segredo-errado"],
      ["the bare secret with no scheme", SECRET],
      ["a prefix of the real one", `Bearer ${SECRET.slice(0, 10)}`],
      ["empty", "Bearer "],
    ])("answers 401 to %s, and runs nothing", async (_label, authorization) => {
      const response = await GET(request("GET", { authorization }));

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toEqual([]);
    });

    it("refuses a signed-in admin with no credential", async () => {
      // A session is not a cron credential. `GET` has no session path at all,
      // so the most privileged person in the organization gets 401 here.
      boxes.role.value = "OWNER";

      const response = await GET(request("GET"));

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toEqual([]);
    });

    it("never answers 403, whatever the session says", async () => {
      // Falling back to a permission check would tell whoever is probing that
      // the secret was the wrong part of the request.
      boxes.role.value = "LEITOR";

      const response = await GET(request("GET", { authorization: "Bearer errado" }));

      expect(response.status).toBe(401);
    });

    it("refuses everything when no secret is configured", async () => {
      // A missing environment variable is the most ordinary deployment mistake
      // there is, and it must not turn this into an open endpoint.
      delete process.env.CRON_SECRET;

      const response = await GET(request("GET", { authorization: `Bearer ${SECRET}` }));

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toEqual([]);
    });
  });

  describe("POST — a person, and only their own queue", () => {
    it("works the actor's organization, never the global queue", async () => {
      const response = await POST();

      expect(response.status).toBe(200);
      expect(boxes.batch.calls).toEqual([{ organizationId: "org-do-ator" }]);
    });

    it("is refused with 403 without `job:run`, even holding `job:read`", async () => {
      boxes.role.value = "OPERADOR";
      expect(permissionsForRole("OPERADOR")).toContain("job:read");

      const response = await POST();

      expect(response.status).toBe(403);
      expect(boxes.batch.calls).toEqual([]);
    });

    it("is refused with 401 when not signed in", async () => {
      boxes.signedIn.value = false;

      const response = await POST();

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toEqual([]);
    });

    it("ignores the cron credential entirely", async () => {
      // Not a second way in. `POST` never reads the header, so the secret
      // cannot be used to escape the organization scope.
      boxes.signedIn.value = false;

      const response = await POST();

      expect(response.status).toBe(401);
      expect(boxes.batch.calls).toEqual([]);
    });
  });
});
