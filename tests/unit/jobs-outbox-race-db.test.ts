import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { enqueueJob, type EnqueueJobParams } from "@/lib/jobs/outbox";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

/**
 * Two transactions, genuinely overlapping.
 *
 * The reads inside `enqueueJob` are advisory: neither transaction can see the
 * other's uncommitted row, so both find nothing and both write. Which index
 * then fires decides what actually happened, and the two answers are not
 * interchangeable — "someone is already generating this project" and "someone
 * enqueued this very step a millisecond ago" call for different things from the
 * caller.
 *
 * The overlap is arranged rather than hoped for: the first transaction inserts
 * and is held open, so the second blocks on the index until the first commits.
 */
describeLocalDatabase("two transactions racing for the same insert", () => {
  let fx: QueueFixture;

  beforeAll(async () => {
    fx = await createQueueFixture();
  });

  afterAll(async () => {
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.job.deleteMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
    });
  });

  /**
   * Runs both enqueues so that the second one is inside the first one's
   * transaction window, and returns what each got.
   */
  async function race(first: EnqueueJobParams, second: EnqueueJobParams) {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted: () => void = () => {};
    const hasInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });

    const winner = prisma.$transaction(
      async (tx) => {
        const job = await enqueueJob(tx, first);
        inserted();
        // Still uncommitted, and holding the index entry.
        await held;
        return job;
      },
      { timeout: 15_000 },
    );

    await hasInserted;

    const loser = prisma
      .$transaction((tx) => enqueueJob(tx, second), { timeout: 15_000 })
      .then((job) => ({ ok: true as const, job }))
      .catch((error: unknown) => ({ ok: false as const, error }));

    // The loser is now blocked on the unique index. Letting the winner commit
    // is what turns that block into a decision.
    setTimeout(release, 150);

    return { winner: await winner, loser: await loser };
  }

  it("tells the loser its step already exists, not that the project is busy", async () => {
    const same: EnqueueJobParams = {
      organizationId: fx.organizationId,
      step: { kind: "generation.poll", generationRunId: fx.generationRunId },
    };

    const { winner, loser } = await race(same, same);

    expect(winner.id).toBeTruthy();
    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    // Not `TRABALHO_EM_ANDAMENTO`: nothing is in progress, and this step is an
    // observer that has no concurrency key at all.
    expect(loser.error).toMatchObject({ code: "ETAPA_ENFILEIRADA_CONCORRENTEMENTE" });

    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(1);
  });

  it("gives the same answer for a mutating step, which also has a concurrency key", async () => {
    // The dangerous confusion. `generation.start` sits under both indexes, and
    // treating every P2002 as `TRABALHO_EM_ANDAMENTO` would report a
    // simultaneous duplicate of the same intention as a second, different
    // generation already running.
    const same: EnqueueJobParams = {
      organizationId: fx.organizationId,
      step: {
        kind: "generation.start",
        generationRunId: fx.generationRunId,
        siteProjectId: fx.siteProjectId,
      },
    };

    const { loser } = await race(same, same);

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error).toMatchObject({ code: "ETAPA_ENFILEIRADA_CONCORRENTEMENTE" });
  });

  it("tells a genuinely different generation that the project is busy", async () => {
    const brief = await prisma.siteBriefVersion.findFirstOrThrow({
      where: { siteProjectId: fx.siteProjectId },
    });
    const otherRun = await prisma.generationRun.create({
      data: {
        siteProjectId: fx.siteProjectId,
        briefVersionId: brief.id,
        provider: "manual",
        requestJson: "{}",
      },
    });

    const { winner, loser } = await race(
      {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
        },
      },
      {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: otherRun.id,
          siteProjectId: fx.siteProjectId,
        },
      },
    );

    expect(winner.generationRunId).toBe(fx.generationRunId);
    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    // Two different intentions, one project. This one really is "in progress".
    expect(loser.error).toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });

    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(1);
  });

  it("lets both through when the projects differ", async () => {
    const brief = await prisma.siteBriefVersion.findFirstOrThrow({
      where: { siteProjectId: fx.siblingSiteProjectId },
    });
    const siblingRun = await prisma.generationRun.create({
      data: {
        siteProjectId: fx.siblingSiteProjectId,
        briefVersionId: brief.id,
        provider: "manual",
        requestJson: "{}",
      },
    });

    const { winner, loser } = await race(
      {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
        },
      },
      {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: siblingRun.id,
          siteProjectId: fx.siblingSiteProjectId,
        },
      },
    );

    expect(winner.id).toBeTruthy();
    expect(loser.ok).toBe(true);
    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(2);
  });
});
