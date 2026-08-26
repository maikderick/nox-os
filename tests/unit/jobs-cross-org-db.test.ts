import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/outbox";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

/**
 * The foreign key is not the guard.
 *
 * `Job.siteProjectId` referencing another organization's project satisfies
 * every constraint in the database: the row exists, the type matches, the
 * cascade is defined. What it does not satisfy is the only question that
 * matters — is it ours? — and nothing in PostgreSQL is in a position to ask it.
 *
 * So the service asks, and this suite exists to prove the service asks rather
 * than assuming the schema did.
 */
describeLocalDatabase("a job never crosses organizations", () => {
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

  it("refuses a job of A that names a project of B", async () => {
    await expect(
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: fx.otherGenerationRunId,
            siteProjectId: fx.otherSiteProjectId,
          },
          payload: { siteProjectId: fx.otherSiteProjectId },
          siteProjectId: fx.otherSiteProjectId,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROJETO_DE_OUTRA_ORGANIZACAO" });

    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(0);
  });

  it("refuses a job of A that names a generation of B", async () => {
    await expect(
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.otherGenerationRunId },
          payload: { generationRunId: fx.otherGenerationRunId },
          generationRunId: fx.otherGenerationRunId,
        }),
      ),
    ).rejects.toMatchObject({ code: "RUN_DE_OUTRA_ORGANIZACAO" });
  });

  it("refuses a project that does not exist at all", async () => {
    await expect(
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: fx.generationRunId,
            siteProjectId: "nao-existe",
          },
          payload: { siteProjectId: "nao-existe" },
          siteProjectId: "nao-existe",
        }),
      ),
    ).rejects.toMatchObject({ code: "PROJETO_DE_OUTRA_ORGANIZACAO" });
  });

  it("lets each organization run its own work at the same time", async () => {
    // Exclusion is per project, not global: B's generation must not wait for A's.
    const [a, b] = await Promise.all([
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: fx.generationRunId,
            siteProjectId: fx.siteProjectId,
          },
          payload: { generationRunId: fx.generationRunId },
          siteProjectId: fx.siteProjectId,
          generationRunId: fx.generationRunId,
        }),
      ),
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.otherOrganizationId,
          step: {
            kind: "generation.start",
            generationRunId: fx.otherGenerationRunId,
            siteProjectId: fx.otherSiteProjectId,
          },
          payload: { generationRunId: fx.otherGenerationRunId },
          siteProjectId: fx.otherSiteProjectId,
          generationRunId: fx.otherGenerationRunId,
        }),
      ),
    ]);

    expect(a.organizationId).toBe(fx.organizationId);
    expect(b.organizationId).toBe(fx.otherOrganizationId);
  });

  it("keeps the same idempotency key usable by two organizations", async () => {
    // The unique index is scoped by organization, so a key that A already used
    // must not make B's queue unusable.
    const keys = await prisma.job.findMany({
      where: { organizationId: { in: [fx.organizationId, fx.otherOrganizationId] } },
      select: { idempotencyKey: true },
    });
    expect(keys).toHaveLength(0);

    const [a, b] = await Promise.all([
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "credit.threshold", reservationId: "reserva-compartilhada" },
          payload: { reservationId: "reserva-compartilhada" },
        }),
      ),
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.otherOrganizationId,
          step: { kind: "credit.threshold", reservationId: "reserva-compartilhada" },
          payload: { reservationId: "reserva-compartilhada" },
        }),
      ),
    ]);

    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.id).not.toBe(b.id);
  });
});
