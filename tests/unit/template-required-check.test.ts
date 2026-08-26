import { describe, expect, it } from "vitest";

import { REQUIRED_CHECK } from "../../src/lib/provisioning/naming";

/**
 * Branch protection asks GitHub for a check by name, and GitHub only knows about
 * *jobs*. `typecheck`, `lint`, `build` and the end-to-end runs are steps inside
 * one job, so requiring them by name would leave protection waiting forever for
 * checks that never arrive.
 *
 * The other half of this agreement is enforced where it belongs:
 * `tests/unit/ci-workflow.test.ts` in `nox-site-template` fails if that
 * repository ever renames or splits the job. A test here that read the sibling
 * checkout looked like a guarantee and was not one — it passes on a machine that
 * happens to have the repository next to this one, and skips in CI, which is
 * exactly where it would have to run.
 */
describe("the check branch protection requires", () => {
  it("is the name the template publishes", () => {
    expect(REQUIRED_CHECK).toBe("verify");
  });

  it("is a single name, not a list", () => {
    expect(typeof REQUIRED_CHECK).toBe("string");
    expect(REQUIRED_CHECK).not.toContain(",");
    expect(REQUIRED_CHECK.trim()).toBe(REQUIRED_CHECK);
  });
});
