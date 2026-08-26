import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/outbox";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * `step` is what a job is; everything else is derived from it or checked
 * against it.
 *
 * The failure this prevents is not a crash. It is a job whose key says one run,
 * whose foreign key points at another, and whose payload names a third — each
 * of the three looking correct to whoever wrote that call, and the handler, the
 * queue screen and the exclusion index each reading a different one.
 */
describeLocalDatabase("the step is the job's identity", () => {
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

  describe("what the caller does not have to say", () => {
    it("derives the payload from the step alone", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        }),
      );

      expect(JSON.parse(job.payloadJson)).toEqual({
        commitSha: SHA,
        generationRunId: fx.generationRunId,
      });
    });

    it("derives the project from the run, for a step that never names one", async () => {
      // An observer names no project, but it has one, and the queue screen has
      // to be able to show it under the project it belongs to.
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        }),
      );

      expect(job.siteProjectId).toBe(fx.siteProjectId);
      expect(job.generationRunId).toBe(fx.generationRunId);
    });

    it("accepts extra payload the step does not determine", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "preview.poll", generationRunId: fx.generationRunId, commitSha: SHA },
          payload: { siteRevisionId: "revisao-1" },
        }),
      );

      expect(JSON.parse(job.payloadJson)).toEqual({
        commitSha: SHA,
        generationRunId: fx.generationRunId,
        siteRevisionId: "revisao-1",
      });
    });

    it("accepts a redundant value that agrees", async () => {
      const job = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
          payload: { generationRunId: fx.generationRunId },
        }),
      );

      expect(job.generationRunId).toBe(fx.generationRunId);
    });
  });

  describe("what it refuses", () => {
    it("refuses a run of this tenant that belongs to another project", async () => {
      // Both rows are ours and both pass every constraint. Only their
      // relationship is wrong — and a `generation.start` like this would lock
      // one project while generating another.
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: {
              kind: "generation.start",
              generationRunId: fx.generationRunId,
              siteProjectId: fx.siblingSiteProjectId,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "RUN_DE_OUTRO_PROJETO" });
    });

    it("refuses a project that is not the run's, even as a redundant field", async () => {
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "generation.poll", generationRunId: fx.generationRunId },
            siteProjectId: fx.siblingSiteProjectId,
          }),
        ),
      ).rejects.toMatchObject({ code: "RUN_DE_OUTRO_PROJETO" });
    });

    it("refuses a foreign key that contradicts the step", async () => {
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "generation.poll", generationRunId: fx.generationRunId },
            generationRunId: fx.otherGenerationRunId,
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTIDADE_DIVERGENTE" });
    });

    it("refuses a payload that contradicts the step", async () => {
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
            payload: { generationRunId: "run-inventado" },
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTIDADE_DIVERGENTE" });
    });

    it("refuses a payload that contradicts the step on any derived field", async () => {
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
            payload: { commitSha: "ffffffffffffffffffffffffffffffffffffffff" },
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTIDADE_DIVERGENTE" });
    });

    it("writes nothing when it refuses", async () => {
      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "generation.poll", generationRunId: fx.generationRunId },
            generationRunId: fx.otherGenerationRunId,
          }),
        ),
      ).rejects.toThrow();

      expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(0);
    });
  });

  describe("a key means one thing, forever", () => {
    it("refuses the same key with different immutable content", async () => {
      // The step determines everything, so reaching this needs a hand-written
      // row — which is the point: the key is what the database enforces, and
      // whatever wrote that row is not the only thing that will ever write one.
      await prisma.job.create({
        data: {
          organizationId: fx.organizationId,
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
          kind: "generation.poll",
          idempotencyKey: `gen:${fx.generationRunId}:poll`,
          payloadJson: JSON.stringify({ generationRunId: "outro-run" }),
        },
      });

      await expect(
        prisma.$transaction((tx) =>
          enqueueJob(tx, {
            organizationId: fx.organizationId,
            step: { kind: "generation.poll", generationRunId: fx.generationRunId },
          }),
        ),
      ).rejects.toMatchObject({ code: "CHAVE_REUSADA_COM_OUTRO_CONTEUDO" });
    });

    it("returns the existing job when the content is the same", async () => {
      const first = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        }),
      );
      const second = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          // Same fields, written in a different order. Sorting in the encoder
          // is what makes this a content comparison rather than a text one.
          step: { kind: "checks.poll", commitSha: SHA, generationRunId: fx.generationRunId },
          payload: { generationRunId: fx.generationRunId, commitSha: SHA },
        }),
      );

      expect(second.id).toBe(first.id);
    });

    it("lets scheduling differ between two enqueues of the same step", async () => {
      // `runAfter` and the deadline are not what a job means. The row that
      // already exists simply keeps its own schedule.
      const first = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
          runAfter: new Date(Date.now() + 60_000),
        }),
      );
      const second = await prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
          runAfter: new Date(Date.now() + 600_000),
          maxAttempts: 9,
        }),
      );

      expect(second.id).toBe(first.id);
      expect(second.runAfter.getTime()).toBe(first.runAfter.getTime());
      expect(second.maxAttempts).toBe(first.maxAttempts);
    });
  });
});
