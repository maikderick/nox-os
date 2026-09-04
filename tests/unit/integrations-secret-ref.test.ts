import { describe, expect, it } from "vitest";

import {
  SECRET_PURPOSES,
  SecretUnavailableError,
  canResolveSecret,
  describeSecretRef,
  fingerprintSecret,
  resolveSecret,
} from "../../src/lib/integrations/secret-ref";

const ref = {
  scope: "PLATAFORMA",
  organizationId: null,
  purpose: "vercel.token",
  envVarName: "TESTE_VERCEL_TOKEN",
  fingerprint: null as string | null,
};

describe("secret references", () => {
  it("keeps the provisioner and the reconciler as separate credentials", () => {
    // Two apps, not one with two hats: each has its own id and its own key.
    expect(SECRET_PURPOSES).toContain("github.provisioner.appId");
    expect(SECRET_PURPOSES).toContain("github.provisioner.privateKey");
    expect(SECRET_PURPOSES).toContain("github.reconciler.appId");
    expect(SECRET_PURPOSES).toContain("github.reconciler.privateKey");

    const provisioner = SECRET_PURPOSES.filter((p) => p.startsWith("github.provisioner."));
    const reconciler = SECRET_PURPOSES.filter((p) => p.startsWith("github.reconciler."));
    expect(new Set([...provisioner, ...reconciler]).size).toBe(4);
  });

  it("reads the value from the environment", () => {
    expect(resolveSecret(ref, { TESTE_VERCEL_TOKEN: "valor-secreto" })).toBe("valor-secreto");
  });

  it("refuses a missing or blank value with the variable to define", () => {
    expect(() => resolveSecret(ref, {})).toThrow(SecretUnavailableError);
    expect(() => resolveSecret(ref, { TESTE_VERCEL_TOKEN: "   " })).toThrow(
      /TESTE_VERCEL_TOKEN/,
    );
    expect(canResolveSecret(ref, {})).toBe(false);
  });

  it("never leaks the value through the error", () => {
    const error = (() => {
      try {
        resolveSecret(ref, {});
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).not.toContain("valor-secreto");
  });

  it("fingerprints without being reversible", () => {
    const digest = fingerprintSecret("valor-secreto");
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain("valor-secreto");
    expect(fingerprintSecret("valor-secreto")).toBe(digest);
    expect(fingerprintSecret("outro-valor")).not.toBe(digest);
  });

  it("describes a reference without carrying the secret", () => {
    const status = describeSecretRef(
      { ...ref, fingerprint: fingerprintSecret("antigo") },
      { TESTE_VERCEL_TOKEN: "novo" },
    );

    expect(status).toMatchObject({
      purpose: "vercel.token",
      envVarName: "TESTE_VERCEL_TOKEN",
      configured: true,
      rotated: true,
    });
    expect(JSON.stringify(status)).not.toContain("novo");
  });

  it("reports not-configured when the variable is absent", () => {
    expect(describeSecretRef(ref, {})).toMatchObject({ configured: false, rotated: false });
  });
});
