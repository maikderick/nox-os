import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { describeLocalDatabase, pointsToLocalPostgres } from "../helpers/jobs-fixtures";

/**
 * Hand-written SQL and `prisma migrate diff` have to agree.
 *
 * Two objects in this phase exist only in a migration file — the partial unique
 * index on `Job.concurrencyKey`, and the total one on the idempotency key.
 * Prisma 5 cannot express the first at all, so the schema carries a comment
 * where the index should be. The danger is quiet: the next person generates a
 * migration by diff, Prisma sees an index in the database it cannot find in the
 * schema, and writes a `DROP INDEX` into their migration. The exclusion then
 * disappears with a green test suite.
 *
 * So this asserts both halves: the diff is empty, and the indexes are really
 * there, with the predicate they were written with.
 */
const hasShadow = pointsToLocalPostgres(process.env.SHADOW_DATABASE_URL);

describeLocalDatabase("schema and migrations do not drift", () => {
  it.runIf(hasShadow)(
    "produces an empty diff even with the hand-written indexes applied",
    () => {
      const script = execFileSync(
        "npx",
        [
          "prisma",
          "migrate",
          "diff",
          "--from-migrations",
          "prisma/migrations",
          "--to-schema-datamodel",
          "prisma/schema.prisma",
          "--shadow-database-url",
          process.env.SHADOW_DATABASE_URL!,
          "--script",
        ],
        { encoding: "utf8", shell: true },
      );

      const statements = script
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("--") && !line.startsWith("│"))
        .filter((line) => !/^[┌└├─]/.test(line));

      expect(statements).toEqual([]);
    },
    120_000,
  );

  it("keeps the two indexes, and keeps the partial one partial", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
        FROM pg_indexes
       WHERE tablename = 'Job'
         AND indexname IN ('Job_idempotency_uniq', 'Job_concurrency_ativo_uniq')
       ORDER BY indexname
    `;

    expect(rows.map((row) => row.indexname)).toEqual([
      "Job_concurrency_ativo_uniq",
      "Job_idempotency_uniq",
    ]);

    const [partial, total] = rows;
    expect(partial!.indexdef).toContain("UNIQUE");
    expect(partial!.indexdef).toContain("WHERE");
    // The status list is the exclusion itself. A terminal job in it would keep
    // a project blocked forever; a live one missing from it would let a second
    // generation start over the first.
    for (const status of ["PENDENTE", "EM_EXECUCAO", "PAUSADO", "CONCILIACAO"]) {
      expect(partial!.indexdef).toContain(status);
    }
    for (const status of ["CONCLUIDO", "FALHOU", "CARTA_MORTA"]) {
      expect(partial!.indexdef).not.toContain(status);
    }

    expect(total!.indexdef).toContain("UNIQUE");
    expect(total!.indexdef).not.toContain("WHERE");
    expect(total!.indexdef).toContain("organizationId");
  });
});
