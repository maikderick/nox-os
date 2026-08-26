import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertCronRequest, hasCronCredential } from "@/lib/jobs/cron-auth";

const SECRET = "segredo-do-agendador-de-teste";

function request(authorization?: string) {
  return new Request("http://localhost/api/jobs/run", {
    method: "GET",
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("the cron credential", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("accepts exactly the header Vercel Cron sends", () => {
    expect(() => assertCronRequest(request(`Bearer ${SECRET}`))).not.toThrow();
  });

  it.each([
    ["the bare secret, no scheme", SECRET],
    ["a lowercase scheme", `bearer ${SECRET}`],
    ["another scheme", `Token ${SECRET}`],
    ["no space after the scheme", `Bearer${SECRET}`],
    ["two spaces", `Bearer  ${SECRET}`],
    ["a wrong secret", "Bearer outro-segredo-qualquer"],
    ["a prefix of the real one", `Bearer ${SECRET.slice(0, 12)}`],
    ["the real one plus more", `Bearer ${SECRET}x`],
    ["empty", ""],
    ["scheme only", "Bearer "],
  ])("refuses %s", (_label, header) => {
    // The whole header is the secret. Anything that would need a parser to be
    // accepted is simply a different string — which is the point: a parser is
    // where "the scheme is optional" gets added later by someone being helpful.
    expect(() => assertCronRequest(request(header))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("accepts surrounding whitespace, because it never arrives", () => {
    // Not leniency on our part: `Headers` strips leading and trailing HTTP
    // whitespace per the Fetch specification, so by the time the value is read
    // it has already been normalised. Asserting a refusal here would be
    // asserting something about a string this code can never receive.
    expect(new Request("http://x", { headers: { authorization: "Bearer abc " } }).headers.get(
      "authorization",
    )).toBe("Bearer abc");

    expect(() => assertCronRequest(request(`  Bearer ${SECRET}  `))).not.toThrow();
  });

  it("refuses a missing header", () => {
    expect(() => assertCronRequest(request())).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("refuses everything when no secret is configured", () => {
    delete process.env.CRON_SECRET;

    expect(() => assertCronRequest(request(`Bearer ${SECRET}`))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
    expect(() => assertCronRequest(request("Bearer "))).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("gives the same refusal whatever the length of what arrived", () => {
    // Both sides are hashed to 32 bytes before the comparison, so a header of
    // one character and one of ten thousand take the same path. Without that,
    // `timingSafeEqual` would throw on the length difference — and an exception
    // that only fires for wrong-length input is itself a signal.
    const shapes = ["x", "Bearer x", "B".repeat(10_000), `Bearer ${"z".repeat(10_000)}`];

    for (const header of shapes) {
      expect(() => assertCronRequest(request(header))).toThrow(
        expect.objectContaining({ status: 401 }),
      );
    }
  });

  it("notices whether a credential was offered at all", () => {
    // This is what routes the request to the cron check instead of the session
    // one; it says nothing about whether the credential is any good.
    expect(hasCronCredential(request("qualquer coisa"))).toBe(true);
    expect(hasCronCredential(request(""))).toBe(true);
    expect(hasCronCredential(request())).toBe(false);
  });
});
