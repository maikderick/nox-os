import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_SECONDS,
  BACKOFF_CEILING_SECONDS,
  backoffCeilingSeconds,
  backoffSeconds,
} from "@/lib/jobs/backoff";

describe("full jitter", () => {
  it("doubles the interval with each failure, from the base", () => {
    expect(backoffCeilingSeconds(0)).toBe(BACKOFF_BASE_SECONDS);
    expect(backoffCeilingSeconds(1)).toBe(60);
    expect(backoffCeilingSeconds(2)).toBe(120);
    expect(backoffCeilingSeconds(3)).toBe(240);
  });

  it("stops at fifteen minutes and stays there", () => {
    expect(backoffCeilingSeconds(5)).toBe(BACKOFF_CEILING_SECONDS);
    expect(backoffCeilingSeconds(9)).toBe(BACKOFF_CEILING_SECONDS);
    expect(backoffCeilingSeconds(500)).toBe(BACKOFF_CEILING_SECONDS);
  });

  it("draws from the whole interval, not from a fraction of it", () => {
    // Exponential backoff alone synchronises: a provider that fails for
    // everyone at once returns every job at the same later instant, and the
    // retry storm reproduces the outage. Spreading the entire window is what
    // breaks the convoy, so the lower bound really is zero.
    expect(backoffSeconds(2, () => 0)).toBe(0);
    expect(backoffSeconds(2, () => 0.5)).toBe(60);
    expect(backoffSeconds(2, () => 0.999999)).toBe(119);
  });

  it("never exceeds the ceiling, at any attempt", () => {
    for (const attempts of [0, 1, 4, 8, 40]) {
      expect(backoffSeconds(attempts, () => 0.999999)).toBeLessThan(BACKOFF_CEILING_SECONDS + 1);
      expect(backoffSeconds(attempts, () => 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats a negative attempt count as the first one", () => {
    expect(backoffCeilingSeconds(-3)).toBe(BACKOFF_BASE_SECONDS);
  });
});
