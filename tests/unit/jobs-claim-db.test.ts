import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { claimJob } from "@/lib/jobs/claim";
import { extendLease, holdsLease } from "@/lib/jobs/heartbeat";

import {
  createQueueFixture,
  describeLocalDatabase,
  dropQueueFixture,
  type QueueFixture,
} from "../helpers/jobs-fixtures";

describeLocalDatabase("acquiring a job is decided by the database", () => {
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

  /** A job written straight to the table, so the test controls every column. */
  async function seed(overrides: Partial<Parameters<typeof prisma.job.create>[0]["data"]> = {}) {
    return prisma.job.create({
      data: {
        organizationId: fx.organizationId,
        generationRunId: fx.generationRunId,
        kind: "generation.poll",
        idempotencyKey: `teste:${Math.random().toString(36).slice(2)}`,
        payloadJson: JSON.stringify({ generationRunId: fx.generationRunId }),
        ...overrides,
      },
    });
  }

  it("gives two consumers two different jobs, not the same one twice", async () => {
    await seed();
    await seed();

    const [first, second] = await Promise.all([
      claimJob({ owner: "consumidor-a" }),
      claimJob({ owner: "consumidor-b" }),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });

  it("lets the second consumer come back empty rather than wait", async () => {
    // `SKIP LOCKED` is what makes this a null instead of a block: the second
    // consumer steps over the locked row and finds nothing else due.
    await seed();

    const [first, second] = await Promise.all([
      claimJob({ owner: "consumidor-a" }),
      claimJob({ owner: "consumidor-b" }),
    ]);

    const claimed = [first, second].filter((job) => job !== null);
    expect(claimed).toHaveLength(1);
  });

  it("hands three jobs to six consumers exactly once each", async () => {
    // The property that matters is not "someone got something", it is that no
    // two consumers ever hold the same job. With more consumers than work, an
    // acquisition that read instead of locking would show up here.
    await Promise.all([seed(), seed(), seed()]);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => claimJob({ owner: `consumidor-${index}` })),
    );

    const ids = results.filter((job) => job !== null).map((job) => job!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("marks what it took, and to whom", async () => {
    const seeded = await seed();
    const claimed = await claimJob({ owner: "consumidor-a" });

    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.status).toBe("EM_EXECUCAO");
    expect(claimed!.leaseOwner).toBe("consumidor-a");
    expect(claimed!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not touch attempts", async () => {
    // Picking work up is not failing at it. Counting here would walk a job to
    // its dead letter for having been looked at five times.
    const seeded = await seed({ attempts: 2 });
    const claimed = await claimJob({ owner: "consumidor-a" });

    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.attempts).toBe(2);
    expect(claimed!.pollCount).toBe(0);
  });

  it("takes a job the database itself just stamped as due", async () => {
    // The queue keeps one clock, and it is the database's. A job whose
    // `runAfter` defaults to `CURRENT_TIMESTAMP` and an acquisition that
    // compared it against a `new Date()` from this process would agree only by
    // luck: a database a few milliseconds ahead makes a due job look pending,
    // and the queue stalls for a tick with nothing in the logs to show for it.
    const seeded = await seed();
    expect(seeded.runAfter.getTime()).toBeGreaterThan(Date.now() - 5_000);

    const claimed = await claimJob({ owner: "consumidor-a" });
    expect(claimed!.id).toBe(seeded.id);
  });

  it("leaves a job whose time has not come", async () => {
    await seed({ runAfter: new Date(Date.now() + 60_000) });

    expect(await claimJob({ owner: "consumidor-a" })).toBeNull();
  });

  it("leaves a job whose lease is still alive", async () => {
    await seed({
      leaseOwner: "consumidor-antigo",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    expect(await claimJob({ owner: "consumidor-b" })).toBeNull();
  });

  it("takes a job whose lease has lapsed", async () => {
    const seeded = await seed({
      leaseOwner: "consumidor-morto",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    const claimed = await claimJob({ owner: "consumidor-b" });
    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.leaseOwner).toBe("consumidor-b");
  });

  it("takes a paused job once its time comes", async () => {
    // Resuming from the brake begins here: a paused job comes back on its own,
    // and the brake gets to decide again instead of someone having to notice.
    const seeded = await seed({
      status: "PAUSADO",
      pausedReason: "INTEGRACAO_DESLIGADA",
      runAfter: new Date(Date.now() - 1_000),
    });

    const claimed = await claimJob({ owner: "consumidor-a" });
    expect(claimed!.id).toBe(seeded.id);
    expect(claimed!.attempts).toBe(0);
  });

  it("leaves a paused job that is still waiting", async () => {
    await seed({ status: "PAUSADO", runAfter: new Date(Date.now() + 60_000) });

    expect(await claimJob({ owner: "consumidor-a" })).toBeNull();
  });

  it.each(["EM_EXECUCAO", "CONCILIACAO", "CONCLUIDO", "FALHOU", "CARTA_MORTA"])(
    "never takes a job in %s",
    async (status) => {
      await seed({ status, runAfter: new Date(Date.now() - 1_000) });

      expect(await claimJob({ owner: "consumidor-a" })).toBeNull();
    },
  );

  it("takes the oldest due job first", async () => {
    const older = await seed({ runAfter: new Date(Date.now() - 60_000) });
    await seed({ runAfter: new Date(Date.now() - 1_000) });

    const claimed = await claimJob({ owner: "consumidor-a" });
    expect(claimed!.id).toBe(older.id);
  });
});

describeLocalDatabase("a lease is extended only by the consumer that holds it", () => {
  let fx: QueueFixture;

  beforeAll(async () => {
    fx = await createQueueFixture();
  });

  afterAll(async () => {
    await dropQueueFixture(fx);
  });

  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { organizationId: fx.organizationId } });
  });

  async function claimed() {
    await prisma.job.create({
      data: {
        organizationId: fx.organizationId,
        generationRunId: fx.generationRunId,
        kind: "generation.poll",
        idempotencyKey: `teste:${Math.random().toString(36).slice(2)}`,
        payloadJson: "{}",
      },
    });
    return (await claimJob({ owner: "dono" }))!;
  }

  it("moves the deadline forward for the owner", async () => {
    const job = await claimed();
    const before = job.leaseExpiresAt!.getTime();

    expect(await extendLease({ jobId: job.id, owner: "dono", leaseSeconds: 600 })).toBe(true);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.leaseExpiresAt!.getTime()).toBeGreaterThan(before);
  });

  it("does nothing for anyone else", async () => {
    const job = await claimed();
    const before = job.leaseExpiresAt!.getTime();

    expect(await extendLease({ jobId: job.id, owner: "intruso", leaseSeconds: 600 })).toBe(false);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.leaseExpiresAt!.getTime()).toBe(before);
  });

  it("does not revive a lease that already lapsed", async () => {
    // The job may already have been handed to someone else; beating again would
    // be taking it back without asking.
    const job = await claimed();
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await extendLease({ jobId: job.id, owner: "dono" })).toBe(false);
    expect(await holdsLease({ jobId: job.id, owner: "dono" })).toBe(false);
  });

  it("answers whether the holder still holds it", async () => {
    const job = await claimed();

    expect(await holdsLease({ jobId: job.id, owner: "dono" })).toBe(true);
    expect(await holdsLease({ jobId: job.id, owner: "outro" })).toBe(false);
  });
});
