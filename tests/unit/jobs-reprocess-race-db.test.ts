import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";
import { reprocessDeadLetter } from "@/lib/jobs/dead-letter";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

/**
 * Two dead letters, one project, and the index that decides between them.
 *
 * The pre-check inside `reprocessDeadLetter` cannot see an uncommitted sibling,
 * so under real concurrency both calls believe the project is free and both
 * write. What refuses the second is `Job_concurrency_ativo_uniq` — and because
 * that write is raw SQL, PostgreSQL's error reaches Prisma as `P2010` carrying
 * SQLSTATE `23505`, not as the `P2002` a typed write would produce.
 *
 * Nothing here is mocked. The error code comes from the database.
 */
describeLocalDatabase("two dead letters of the same project, revived at once", () => {
  let fx: QueueFixture;
  let actor: Actor;
  let userId: string;

  beforeAll(async () => {
    fx = await createQueueFixture();
    const user = await prisma.user.create({
      data: {
        email: `corrida-${fx.token}@example.test`,
        name: "Operador",
        passwordHash: "nao-usado-por-este-teste",
        role: "admin",
      },
    });
    userId = user.id;
    actor = {
      userId: user.id,
      email: user.email,
      name: "Operador",
      organizationId: fx.organizationId,
      organizationSlug: "fila",
      organizationName: "Fila",
      membershipId: "m-1",
      role: "ADMIN",
      permissions: permissionsForRole("ADMIN"),
    };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  /** A dead letter holding the project's exclusion key. */
  async function deadLetter(suffix: string) {
    return prisma.job.create({
      data: {
        organizationId: fx.organizationId,
        siteProjectId: fx.siteProjectId,
        generationRunId: fx.generationRunId,
        kind: "generation.start",
        idempotencyKey: `gen:${fx.generationRunId}:start:${suffix}`,
        concurrencyKey: `project:${fx.siteProjectId}`,
        payloadJson: JSON.stringify({ generationRunId: fx.generationRunId }),
        status: "CARTA_MORTA",
        attempts: 5,
        finishedAt: new Date(),
        lastErrorCode: "ERRO_INESPERADO",
      },
    });
  }

  it("revives exactly one, refuses the other, and audits once", async () => {
    const [primeiro, segundo] = await Promise.all([deadLetter("a"), deadLetter("b")]);

    const results = await Promise.allSettled([
      reprocessDeadLetter(actor, primeiro.id),
      reprocessDeadLetter(actor, segundo.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "TRABALHO_EM_ANDAMENTO",
    });

    // The loser's whole transaction rolled back, so its audit went with it.
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(1);

    const statuses = await prisma.job.findMany({
      where: { id: { in: [primeiro.id, segundo.id] } },
      select: { status: true },
      orderBy: { idempotencyKey: "asc" },
    });
    expect(statuses.map((job) => job.status).sort()).toEqual(["CARTA_MORTA", "PENDENTE"]);
  });

  it("holds over repeated races, whichever side wins", async () => {
    // The two calls can interleave two ways: the loser's pre-check may see the
    // winner already live, or it may see nothing and be refused by the index.
    // The property has to hold either way, so the race is run repeatedly.
    for (let round = 0; round < 8; round += 1) {
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.job.deleteMany({ where: { organizationId: fx.organizationId } });

      const [a, b] = await Promise.all([deadLetter(`r${round}a`), deadLetter(`r${round}b`)]);
      const results = await Promise.allSettled([
        reprocessDeadLetter(actor, a.id),
        reprocessDeadLetter(actor, b.id),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
      ).toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });
      expect(await prisma.auditLog.count({ where: { userId } })).toBe(1);
      expect(
        await prisma.job.count({ where: { organizationId: fx.organizationId, status: "PENDENTE" } }),
      ).toBe(1);
    }
  });

  it("reaches the index path specifically, and reads it as a busy project", async () => {
    // Deterministic version of the same collision: a sibling holds the
    // exclusion key in an uncommitted transaction, so the pre-check genuinely
    // cannot see it and the index is the only thing left to refuse. This is the
    // path that arrives as `P2010`/`23505`; without handling it the operator
    // would get a 500 and a correlation id instead of a sentence.
    const morto = await deadLetter("sozinho");

    let liberar: () => void = () => {};
    const seguro = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let inserido: () => void = () => {};
    const jaInseriu = new Promise<void>((resolve) => {
      inserido = resolve;
    });

    const bloqueador = prisma.$transaction(
      async (tx) => {
        await tx.job.create({
          data: {
            organizationId: fx.organizationId,
            siteProjectId: fx.siteProjectId,
            generationRunId: fx.generationRunId,
            kind: "generation.start",
            idempotencyKey: `gen:${fx.generationRunId}:start:bloqueador`,
            concurrencyKey: `project:${fx.siteProjectId}`,
            payloadJson: "{}",
            status: "PENDENTE",
          },
        });
        inserido();
        await seguro;
      },
      { timeout: 15_000 },
    );

    await jaInseriu;
    const tentativa = reprocessDeadLetter(actor, morto.id).catch((error: unknown) => error);
    setTimeout(liberar, 150);

    const [, resultado] = await Promise.all([bloqueador, tentativa]);

    expect(resultado).toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: morto.id } })).status).toBe(
      "CARTA_MORTA",
    );
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(0);
  });

  it("still refuses when the pre-check is the one that sees it", async () => {
    // The other order, so both branches are covered on purpose rather than by
    // whichever the scheduler happened to pick.
    const vivo = await deadLetter("vivo");
    await prisma.job.update({ where: { id: vivo.id }, data: { status: "PENDENTE" } });
    const morto = await deadLetter("morto");

    await expect(reprocessDeadLetter(actor, morto.id)).rejects.toMatchObject({
      code: "TRABALHO_EM_ANDAMENTO",
    });
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(0);
  });
});
