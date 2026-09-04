/**
 * The installation-wide brake is off unless a test turns it on.
 *
 * `NOX_INTEGRATIONS=disabled` forces every provider off for the whole
 * installation, and `.env.example` ships it set — so a developer who follows the
 * README (`cp .env.example .env`) has it in their `.env`. That file is not
 * loaded by Vitest, but it **is** loaded by Prisma Client when it initialises,
 * which means it reaches `process.env` in whichever workers happen to import a
 * module that touches the database, and only after that import has run.
 *
 * The result was a suite whose outcome depended on module import order: the
 * consumer's jobs were paused by a brake nobody in the test had switched on,
 * and the same file passed or failed depending on what ran before it. That is
 * the worst kind of failure — it is not flaky enough to be distrusted, so it
 * gets read as a real regression.
 *
 * So the brake is neutralised here, in a setup file, which runs in every worker
 * before any test module is imported.
 *
 * **It is set to empty rather than deleted, and that difference is the whole
 * fix.** `dotenv` — which is what Prisma uses — never overwrites a key that is
 * already present, and always sets one that is absent. Deleting the variable
 * therefore hands it straight back to `.env` the moment Prisma loads, which is
 * exactly the bug. An empty string is present, so `.env` cannot replace it, and
 * `environmentForcesDisabled` reads it as "no brake" because it is not the
 * literal word `disabled`.
 *
 * The suites that *are* about the brake — `jobs-gate-db`, `integrations-route`,
 * `integrations-modes` — set it themselves, and now start from a known value
 * rather than from whatever the developer's `.env` happened to say.
 */
process.env.NOX_INTEGRATIONS = "";
