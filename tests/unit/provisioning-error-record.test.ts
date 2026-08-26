import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "../../src/lib/authz/errors";
import {
  IntegrationDisabledError,
  ProviderPreflightError,
  ProviderResourceConflictError,
} from "../../src/lib/providers/errors";
import { ProvisioningNotEligibleError } from "../../src/lib/provisioning/eligibility";
import {
  UNKNOWN_ERROR_CODE,
  describeErrorForStorage,
  formatStoredError,
} from "../../src/lib/provisioning/error-record";

/**
 * Every one of these is a real leak shape, and the point is that not one of them
 * is matched by a pattern. They are withheld because the error is not one this
 * application built — which is true of any format, including formats that do not
 * exist yet.
 */
const LEAKS: Array<[string, string]> = [
  ["github fine-grained token", "401 para github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdef"],
  ["github classic token", "bad credentials: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
  ["vercel token", "GET /v9/projects 403 {\"token\":\"AbCdEf0123456789GhIjKlMnOpQr\"}"],
  ["anthropic key", "invalid x-api-key: sk-ant-api03-AbCdEf-0123456789_GhIjKlMnOpQrStUvWxYz"],
  ["cookie", "set-cookie: _vercel_jwt=eyJhbGciOi.eyJzdWIiOi.QWxhZGRpbjpvcGVu; HttpOnly"],
  [
    "private key",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3\n-----END RSA PRIVATE KEY-----",
  ],
  ["unknown format", "provider said: <<<XYZ-9f3a::7712::segredo-de-formato-desconhecido>>>"],
];

describe("what may be written down about a failure", () => {
  it("keeps the message when this application built it", () => {
    const stored = describeErrorForStorage(
      new ProviderPreflightError("A instalação da Vercel ainda não enxerga nox-sites/site-x."),
    );

    expect(stored).toMatchObject({
      code: "PREFLIGHT_FALHOU",
      message: "A instalação da Vercel ainda não enxerga nox-sites/site-x.",
    });
    expect(stored.correlationId).toBeUndefined();
  });

  it.each([
    ["integração desligada", new IntegrationDisabledError("github"), "INTEGRACAO_DESLIGADA"],
    [
      "conflito de recurso",
      new ProviderResourceConflictError("O repositório nox-sites/site-x"),
      "RECURSO_JA_EXISTE",
    ],
    [
      "projeto inelegível",
      new ProvisioningNotEligibleError("PROJETO_NAO_ELEGIVEL", "O projeto precisa estar pronto."),
      "PROJETO_NAO_ELEGIVEL",
    ],
    ["autorização", AuthorizationError.missingPermission("provisioning:run"), undefined],
  ])("keeps %s", (_label, error, code) => {
    const stored = describeErrorForStorage(error);
    expect(stored.correlationId).toBeUndefined();
    if (code) expect(stored.code).toBe(code);
    expect(stored.message).toBe((error as Error).message);
  });

  it.each(LEAKS)("withholds everything from an unrecognised error: %s", (_label, raw) => {
    const logged: string[] = [];
    const stored = describeErrorForStorage(new Error(raw), (line) => logged.push(line));

    // Nothing of the original survives into what gets stored.
    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(stored.message).not.toContain(raw);
    expect(stored.correlationId).toMatch(/^[0-9a-f-]{36}$/);

    const line = formatStoredError(stored);
    for (const fragment of raw.split(/\s+/).filter((part) => part.length > 12)) {
      expect(line).not.toContain(fragment);
    }

    // The detail is still reachable, next to the id, in the server log.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(stored.correlationId!);
    expect(logged[0]).toContain(raw);
  });

  it("withholds a thrown value that is not even an Error", () => {
    const stored = describeErrorForStorage(
      { token: "github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRs" },
      () => {},
    );

    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(formatStoredError(stored)).not.toContain("github_pat_");
  });

  it("does not smuggle the original through a subclass of Error", () => {
    class ProviderHttpError extends Error {
      readonly code = "HTTP_401";
    }

    const stored = describeErrorForStorage(
      new ProviderHttpError("Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
      () => {},
    );

    // Having a `code` is not enough: the class has to be one of ours.
    expect(stored.code).toBe(UNKNOWN_ERROR_CODE);
    expect(stored.message).not.toContain("ghp_");
  });

  it("logs to the console by default, and not to the caller", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      describeErrorForStorage(new Error("segredo-qualquer-1234567890"));
      expect(spy).toHaveBeenCalledOnce();
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
