import { describe, expect, it } from "vitest";

import { publicHttpUrlSchema } from "@/lib/ssrf";

describe("publicHttpUrlSchema", () => {
  it.each([
    "http://localhost",
    "http://127.0.0.1",
    "http://[::1]",
    "http://[::]",
    "http://[::ffff:127.0.0.1]",
    "http://[fc00::1]",
    "http://[fd12::1]",
    "http://[fe80::1]",
    "http://169.254.169.254/latest/meta-data",
    "https://service.internal",
  ])("blocks non-public destination %s", (url) => {
    expect(publicHttpUrlSchema.safeParse(url).success).toBe(false);
  });

  it.each(["https://example.com", "http://8.8.8.8/status"])(
    "accepts syntactically public destination %s",
    (url) => {
      expect(publicHttpUrlSchema.safeParse(url).success).toBe(true);
    },
  );
});
