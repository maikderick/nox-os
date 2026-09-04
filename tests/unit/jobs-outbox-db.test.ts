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

describeLocalDatabase("the outbox, against the database itself", () => {
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

  it("holds the whole chain of one run at the same time", async () => {
    // The test the previous design would have failed. One key for the whole
    // generation meant the second step looked like a duplicate of the first,
    // and the chain could not physically exist.
    await prisma.$transaction(async (tx) => {
      await enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: fx.generationRunId,
          siteProjectId: fx.siteProjectId,
        },
        payload: { generationRunId: fx.generationRunId },
        siteProjectId: fx.siteProjectId,
        generationRunId: fx.generationRunId,
      });
      await enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        payload: { generationRunId: fx.generationRunId },
        generationRunId: fx.generationRunId,
      });
      await enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        payload: { generationRunId: fx.generationRunId, commitSha: SHA },
        generationRunId: fx.generationRunId,
      });
      await enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "preview.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        payload: { generationRunId: fx.generationRunId, commitSha: SHA },
        generationRunId: fx.generationRunId,
      });
    });

    const kinds = (
      await prisma.job.findMany({
        where: { generationRunId: fx.generationRunId },
        orderBy: { kind: "asc" },
        select: { kind: true },
      })
    ).map((job) => job.kind);

    expect(kinds).toEqual(["checks.poll", "generation.poll", "generation.start", "preview.poll"]);
  });

  it("returns the existing job when the same step is enqueued twice", async () => {
    const first = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        payload: { generationRunId: fx.generationRunId },
        generationRunId: fx.generationRunId,
      }),
    );
    const second = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        payload: { generationRunId: fx.generationRunId },
        generationRunId: fx.generationRunId,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(await prisma.job.count({ where: { generationRunId: fx.generationRunId } })).toBe(1);
  });

  it("refuses a second mutating job while the first is alive", async () => {
    await prisma.$transaction((tx) =>
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
    );

    const secondRun = await prisma.generationRun.create({
      data: {
        siteProjectId: fx.siteProjectId,
        briefVersionId: (await prisma.siteBriefVersion.findFirstOrThrow({
          where: { siteProjectId: fx.siteProjectId },
        })).id,
        provider: "manual",
        requestJson: JSON.stringify({ origem: "teste" }),
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: secondRun.id,
            siteProjectId: fx.siteProjectId,
          },
          payload: { generationRunId: secondRun.id },
          siteProjectId: fx.siteProjectId,
          generationRunId: secondRun.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });
  });

  it("lets an observer in while a mutating job is alive", async () => {
    await prisma.$transaction((tx) =>
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
    );

    const observer = await prisma.$transaction((tx) =>
      enqueueJob(tx, {
        organizationId: fx.organizationId,
        step: { kind: "checks.poll", generationRunId: fx.generationRunId, commitSha: SHA },
        payload: { generationRunId: fx.generationRunId, commitSha: SHA },
        siteProjectId: fx.siteProjectId,
        generationRunId: fx.generationRunId,
      }),
    );

    expect(observer.concurrencyKey).toBeNull();
  });

  describe.each([
    ["CONCLUIDO", true],
    ["FALHOU", true],
    ["CARTA_MORTA", true],
    ["PENDENTE", false],
    ["EM_EXECUCAO", false],
    ["PAUSADO", false],
    ["CONCILIACAO", false],
  ] as const)("with the first mutating job in %s", (status, letsNextIn) => {
    it(`${letsNextIn ? "lets" : "keeps"} the next one ${letsNextIn ? "in" : "out"}`, async () => {
      const first = await prisma.$transaction((tx) =>
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
      );
      await prisma.job.update({ where: { id: first.id }, data: { status } });

      const brief = await prisma.siteBriefVersion.findFirstOrThrow({
        where: { siteProjectId: fx.siteProjectId },
      });
      const nextRun = await prisma.generationRun.create({
        data: {
          siteProjectId: fx.siteProjectId,
          briefVersionId: brief.id,
          provider: "manual",
          requestJson: JSON.stringify({ origem: "teste" }),
        },
      });

      const attempt = prisma.$transaction((tx) =>
        enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: {
            kind: "generation.start",
            generationRunId: nextRun.id,
            siteProjectId: fx.siteProjectId,
          },
          payload: { generationRunId: nextRun.id },
          siteProjectId: fx.siteProjectId,
          generationRunId: nextRun.id,
        }),
      );

      if (letsNextIn) {
        await expect(attempt).resolves.toMatchObject({ kind: "generation.start" });
      } else {
        await expect(attempt).rejects.toMatchObject({ code: "TRABALHO_EM_ANDAMENTO" });
      }
    });
  });

  it("refuses to enqueue outside a transaction", async () => {
    // The signature accepts the root client happily; only this check does not.
    await expect(
      enqueueJob(prisma, {
        organizationId: fx.organizationId,
        step: { kind: "generation.poll", generationRunId: fx.generationRunId },
        payload: { generationRunId: fx.generationRunId },
        generationRunId: fx.generationRunId,
      }),
    ).rejects.toMatchObject({ code: "FORA_DE_TRANSACAO" });

    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(0);
  });

  it("loses the job when the fact it accompanies is rolled back", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueJob(tx, {
          organizationId: fx.organizationId,
          step: { kind: "generation.poll", generationRunId: fx.generationRunId },
          payload: { generationRunId: fx.generationRunId },
          generationRunId: fx.generationRunId,
        });
        throw new Error("o fato nao foi gravado");
      }),
    ).rejects.toThrow();

    expect(await prisma.job.count({ where: { organizationId: fx.organizationId } })).toBe(0);
  });
});
