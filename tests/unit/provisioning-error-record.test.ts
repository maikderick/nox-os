import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "../../src/lib/authz/errors";
import { ProviderPreflightError } from "../../src/lib/providers/errors";
import {
  UNKNOWN_ERROR_CODE,
  describeErrorForStorage,
  formatStoredError,
} from "../../src/lib/provisioning/error-record";
import { ProvisioningRefusal, buildReasonMessage } from "../../src/lib/provisioning/reasons";

/**
 * Real leak shapes. Not one of them is matched by a pattern — they are withheld
 * because the error carries no reason this application recognises, which is
 * equally true of formats that do not exist yet.
 */
const LEAKS: Array<[string, string]> = [
  [
    "github fine-grained",
    "401 para github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdef",
  ],
  ["github classic", "bad credentials: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
  ["vercel", 'GET /v9/projects 403 {"token":"AbCdEf0123456789GhIjKlMnOpQr"}'],
  ["anthropic", "invalid x-api-key: sk-ant-api03-AbCdEf-0123456789_GhIjKlMnOpQrStUvWxYz"],
  ["cookie", "set-cookie: _vercel_jwt=eyJhbGciOi.eyJzdWIiOi.QWxhZGRpbjpvcGVu; HttpOnly"],
  [
    "private key",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3\n-----END RSA PRIVATE KEY-----",
  ],
  ["formato desconhecido", "provider said: <<<XYZ-9f3a::7712::segredo-de-formato-novo>>>"],
];

/** Anything long enough to be a credential rather than a common word. */
function significantFragments(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part.length > 12);
}

describe("what may be written down about a failure", () => {
  it("rebuilds the message from the reason, rather than copying the instance", () => {
    const refusal = new ProvisioningRefusal("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO", {
      owner: "nox-sites",
      repository: "site-oficina",
    });

    const stored = describeErrorForStorage(refusal);

    expect(stored.code).toBe("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO");
    expect(stored.message).toBe(
      buildReasonMessage("HOSPEDAGEM_SEM_ACESSO_AO_REPOSITORIO", {
        owner: "nox-sites",
        repository: "site-oficina",
      }),
    );
    expect(stored.correlationId).toBeUndefined();
  });

  it("withholds a provider message wrapped in one of our own classes", () => {
    // The point of the whole redesign: `instanceof` is not consent. These
    // classes accept arbitrary text, so belonging to us proves nothing about
    // where the text came from.
    const leaked = "401 Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const stored = describeErrorForStorage(new ProviderPreflightError(leaked), { log: () => {} });

    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(stored.message).not.toContain("ghp_");
    expect(stored.correlationId).toBeTruthy();
  });

  it("rebuilds an authorization refusal instead of trusting its message", () => {
    const error = AuthorizationError.missingPermission("provisioning:run");
    // The constructor is public, so a future caller could put anything here.
    error.message = "Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    const stored = describeErrorForStorage(error);

    expect(stored.code).toBe("SEM_AUTORIZACAO");
    expect(stored.message).toBe(buildReasonMessage("SEM_AUTORIZACAO"));
    expect(stored.message).not.toContain("ghp_");
  });

  describe.each(LEAKS)("an unrecognised error carrying %s", (_label, raw) => {
    it("keeps nothing of it in what is stored", () => {
      const stored = describeErrorForStorage(new Error(raw), { log: () => {} });

      expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
      expect(stored.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      for (const fragment of significantFragments(raw)) {
        expect(formatStoredError(stored)).not.toContain(fragment);
      }
    });

    it("keeps nothing of it in the log either", () => {
      // This is the inversion. A message unsafe for a column is unsafe for a
      // log file, which gets shipped, indexed and read by more people than the
      // database ever is. The log gets the correlation id and a closed
      // classification, and that is all.
      const lines: string[] = [];
      const stored = describeErrorForStorage(new Error(raw), {
        step: "repository",
        log: (line) => lines.push(line),
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(stored.correlationId!);
      expect(lines[0]).toContain("etapa=repository");
      expect(lines[0]).toMatch(/classe=(banco|tipo-inesperado|desconhecido)/);

      for (const fragment of significantFragments(raw)) {
        expect(lines[0]).not.toContain(fragment);
      }
      expect(lines[0]).not.toContain(raw);
    });
  });

  it("withholds a thrown value that is not even an Error", () => {
    const lines: string[] = [];
    const stored = describeErrorForStorage(
      { token: "github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRs" },
      { log: (line) => lines.push(line) },
    );

    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(formatStoredError(stored)).not.toContain("github_pat_");
    expect(lines[0]).not.toContain("github_pat_");
    expect(lines[0]).toContain("classe=tipo-inesperado");
  });

  it("does not let a subclass of Error smuggle text through", () => {
    class ProviderHttpError extends Error {
      readonly code = "HTTP_401";
      readonly reason = "INTEGRACAO_DESLIGADA";
    }

    // Imitating both the `code` and the `reason` fields is still not enough:
    // only the actual refusal type is trusted.
    const stored = describeErrorForStorage(
      new ProviderHttpError("Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
      { log: () => {} },
    );

    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(stored.message).not.toContain("ghp_");
  });

  it("logs to the console by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      describeErrorForStorage(new Error("segredo-qualquer-1234567890"));
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0][0])).not.toContain("segredo-qualquer");
    } finally {
      spy.mockRestore();
    }
  });

  it("appends the correlation id only when there is one", () => {
    expect(formatStoredError({ code: "X", message: "mensagem" })).toBe("mensagem");
    expect(formatStoredError({ code: "X", message: "mensagem", correlationId: "abc" })).toContain(
      "abc",
    );
  });
});
