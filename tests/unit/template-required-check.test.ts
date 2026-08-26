import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_CHECK } from "../../src/lib/provisioning/naming";

/**
 * Branch protection asks GitHub for a check by name, and GitHub only knows about
 * *jobs*. `typecheck`, `lint`, `build` and the end-to-end runs are steps inside
 * one job, so requiring them by name would leave protection waiting forever for
 * checks that never arrive.
 *
 * The name therefore has to match the template's workflow exactly. Renaming the
 * job there must break here — not in production, on the first site whose branch
 * protection silently never satisfies.
 */
describe("the check branch protection requires", () => {
  it("is exactly one name", () => {
    expect(REQUIRED_CHECK).toBe("verify");
  });
});

/** Reads top-level job keys without pulling in a YAML parser. */
function jobNames(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === "jobs:");
  if (start < 0) return [];

  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // left the jobs block
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

const templateWorkflow = resolve(
  process.cwd(),
  "..",
  "nox-site-template",
  ".github/workflows/ci.yml",
);

// The template is a separate repository on its own release schedule. When a
// checkout sits beside this one, the agreement is verified for real; when it
// does not, the constant above still holds the line.
const describeWithTemplate = existsSync(templateWorkflow) ? describe : describe.skip;

describeWithTemplate("the template's CI, when a checkout is available", () => {
  const workflow = existsSync(templateWorkflow)
    ? readFileSync(templateWorkflow, "utf8")
    : "";

  it("declares exactly one job", () => {
    expect(jobNames(workflow)).toHaveLength(1);
  });

  it("names that job what this server requires", () => {
    expect(jobNames(workflow)).toEqual([REQUIRED_CHECK]);
  });
});
