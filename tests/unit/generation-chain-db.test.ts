import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { pollGeneration } from "@/lib/generation/poll";
import { pollChecks } from "@/lib/generation/checks";
import { pollPreview } from "@/lib/generation/preview";
import { startGeneration } from "@/lib/generation/start";
import { runJobBatch } from "@/lib/jobs/consumer";
import { sharedFakeAgentWorld } from "@/lib/codegen/fake/fake-agent";
import { sharedFakeWorld } from "@/lib/providers/fake/fake-world";
import { setIntegrationMode } from "@/lib/integrations/settings-service";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  provisionFakeWorld,
  requestFor,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * The chain, end to end, through the consumer.
 *
 * Everything here goes through `runJobBatch` rather than calling the steps
 * directly, because the properties being asserted are properties of the loop:
 * that waiting does not consume attempts, that the two observers close the
 * generation whichever finishes last, and that the reservation is settled
 * exactly once by the time the queue is empty.
 */
describeLocalDatabase("a cadeia de geração", () => {
  let fx: GenerationFixture;

  beforeEach(async () => {
    sharedFakeWorld.reset();
    sharedFakeAgentWorld.reset();
    // The agent finishes on its first poll unless a test says otherwise. The
    // suites that care about deferral set their own number; everywhere else the
    // extra round trip is noise.
    sharedFakeAgentWorld.pollsBeforeFinish = 0;
    fx = await createGenerationFixture();
    await provisionFakeWorld(fx);
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  /** Polls the agent until it is no longer running. */
  async function pollUntilSettled(generationRunId: string, limit = 6) {
    for (let i = 0; i < limit; i += 1) {
      const outcome = await pollGeneration({ generationRunId });
      if (outcome.type !== "aguardar") return outcome;
    }
    throw new Error("O agente não terminou dentro do limite de polls.");
  }

  /** Works the queue until it stops moving, or until the guard trips. */
  async function drain(maxCycles = 12) {
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      // Anything deferred is due immediately: this suite is about ordering, not
      // about waiting thirty real seconds per poll.
      await prisma.job.updateMany({
        where: { organizationId: fx.organizationId, status: "PENDENTE" },
        data: { runAfter: new Date(Date.now() - 1_000) },
      });

      const report = await runJobBatch({
        organizationId: fx.organizationId,
        budgetMs: 30_000,
      });
      if (report.claimed === 0) return report;
    }
    throw new Error("A fila não parou de se mover dentro do limite de ciclos.");
  }

  const state = async () =>
    (await prisma.siteProject.findUniqueOrThrow({ where: { id: fx.siteProjectId } })).status;

  describe("ponta a ponta", () => {
    for (const mode of ["FALSO", "SANDBOX"] as const) {
      it(`chega a PREVIA_PRONTA em ${mode}, com a reserva consumida`, async () => {
        for (const provider of ["github", "vercel", "cursor"] as const) {
          await setIntegrationMode({ actor: fx.actor, provider, mode });
        }

        const { generationRunId } = await requestFor(fx);
        expect(await state()).toBe("GERANDO");

        await drain();

        expect(await state()).toBe("PREVIA_PRONTA");

        const run = await prisma.generationRun.findUniqueOrThrow({
          where: { id: generationRunId },
        });
        expect(run.status).toBe("CONCLUIDO");
        expect(run.startDisposition).toBe("INICIADO");
        expect(run.branch).toBeTruthy();
        expect(run.pullRequestUrl).toBeTruthy();

        // Exactly one revision, one usage line, one settled reservation.
        const revisions = await prisma.siteRevision.findMany({
          where: { siteProjectId: fx.siteProjectId },
        });
        expect(revisions).toHaveLength(1);
        expect(
          await prisma.usageLedger.count({
            where: { organizationId: fx.organizationId, reference: generationRunId },
          }),
        ).toBe(1);

        const reservation = await prisma.creditReservation.findUniqueOrThrow({
          where: { generationRunId },
        });
        expect(reservation.status).toBe("CONSUMIDA");
        expect(reservation.reconciledCents).toBe(1_500);

        const account = await prisma.creditAccount.findUniqueOrThrow({
          where: { organizationId: fx.organizationId },
        });
        expect(account.reservedCents).toBe(0);
        expect(account.balanceCents).toBe(100_000 - 1_500);
        expect(account.consumedThisMonthCents).toBe(1_500);
        expect(account.blockedAt).toBeNull();

        // No watcher left alive over a settled reservation.
        const watcher = await prisma.job.findFirstOrThrow({
          where: { organizationId: fx.organizationId, kind: "credit.threshold" },
        });
        expect(["CONCLUIDO", "FALHOU", "CARTA_MORTA"]).toContain(watcher.status);
      });
    }

    it("esperar não gasta tentativa nem caminha para carta morta", async () => {
      // Three polls before the agent finishes, so the poller has to defer and
      // come back — which is the case that a naive retry counter destroys.
      sharedFakeAgentWorld.pollsBeforeFinish = 3;

      const { generationRunId } = await requestFor(fx);
      await drain();

      const poll = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId, kind: "generation.poll" },
      });
      expect(poll.attempts).toBe(0);
      expect(poll.pollCount).toBeGreaterThan(0);
      expect(poll.status).toBe("CONCLUIDO");
      expect(await state()).toBe("PREVIA_PRONTA");
      expect(
        (await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } })).status,
      ).toBe("CONCLUIDO");
    });
  });

  describe("o poll do agente", () => {
    it("cria uma revisão e dois irmãos, e repetir não duplica nada", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });

      await pollUntilSettled(generationRunId);
      // Repeating the finished poll is the resume path: it must adopt what is
      // there rather than build a second of everything.
      await pollGeneration({ generationRunId });

      expect(
        await prisma.siteRevision.count({ where: { siteProjectId: fx.siteProjectId } }),
      ).toBe(1);
      expect(
        await prisma.job.count({
          where: { organizationId: fx.organizationId, kind: "checks.poll" },
        }),
      ).toBe(1);
      expect(
        await prisma.job.count({
          where: { organizationId: fx.organizationId, kind: "preview.poll" },
        }),
      ).toBe(1);
      expect(
        await prisma.usageLedger.count({
          where: { organizationId: fx.organizationId, reference: generationRunId },
        }),
      ).toBe(1);
    });

    it("dois handlers concluindo ao mesmo tempo produzem uma revisão só", async () => {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });

      // Two real transactions racing. The unique index on
      // `SiteRevision.generationRunId` knocks the loser down; it re-reads,
      // recognises the revision that exists, and carries on to the handoff.
      const [a, b] = await Promise.allSettled([
        pollGeneration({ generationRunId }),
        pollGeneration({ generationRunId }),
      ]);

      expect([a.status, b.status]).not.toContain("rejected");
      expect(
        await prisma.siteRevision.count({ where: { siteProjectId: fx.siteProjectId } }),
      ).toBe(1);
      expect(
        await prisma.usageLedger.count({
          where: { organizationId: fx.organizationId, reference: generationRunId },
        }),
      ).toBe(1);
    });

    it("o agente falhando derruba o projeto e cobra o trabalho que houve", async () => {
      sharedFakeAgentWorld.nextRunFails = true;

      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });
      await pollUntilSettled(generationRunId);

      expect(await state()).toBe("FALHOU");
      expect(
        (await prisma.generationRun.findUniqueOrThrow({ where: { id: generationRunId } })).status,
      ).toBe("FALHOU");
      // The agent ran. Refunding it would make the ledger describe a call that
      // never happened.
      expect(
        await prisma.creditReservation.findUniqueOrThrow({ where: { generationRunId } }),
      ).toMatchObject({ status: "CONSUMIDA" });
    });
  });

  describe("os irmãos e a barreira", () => {
    async function upToObservers() {
      const { generationRunId } = await requestFor(fx);
      await startGeneration({ generationRunId });
      await pollUntilSettled(generationRunId);
      return generationRunId;
    }

    it("rodando em qualquer ordem, o último a gravar conclui", async () => {
      const generationRunId = await upToObservers();

      await pollChecks({ generationRunId });
      expect(await state()).toBe("GERANDO");

      await pollPreview({ generationRunId });
      expect(await state()).toBe("PREVIA_PRONTA");
    });

    it("na ordem inversa, o resultado é o mesmo", async () => {
      const generationRunId = await upToObservers();

      await pollPreview({ generationRunId });
      expect(await state()).toBe("GERANDO");

      await pollChecks({ generationRunId });
      expect(await state()).toBe("PREVIA_PRONTA");
    });

    it("rodar duas vezes não duplica o fato", async () => {
      const generationRunId = await upToObservers();

      await pollChecks({ generationRunId });
      await pollChecks({ generationRunId });
      await pollPreview({ generationRunId });
      await pollPreview({ generationRunId });

      const revision = await prisma.siteRevision.findUniqueOrThrow({
        where: { generationRunId },
      });
      expect(
        await prisma.generationCheck.count({ where: { siteRevisionId: revision.id } }),
      ).toBe(1);
      expect(await prisma.deployment.count({ where: { siteRevisionId: revision.id } })).toBe(1);
    });

    it("terminando juntos, só um transiciona e só um audita", async () => {
      const generationRunId = await upToObservers();

      await Promise.allSettled([
        pollChecks({ generationRunId }),
        pollPreview({ generationRunId }),
      ]);

      expect(await state()).toBe("PREVIA_PRONTA");

      const audits = await prisma.auditLog.findMany({
        where: {
          action: "site_project.transicao_de_sistema",
          entityId: fx.siteProjectId,
        },
      });
      // One observer transitions, one audits, and the audit line never comes
      // out twice.
      expect(audits).toHaveLength(1);
      expect(String(audits[0].metaJson)).toContain("PREVIA_PRONTA");

      // And the money moved exactly once.
      const consumos = await prisma.creditLedgerEntry.count({
        where: { organizationId: fx.organizationId, movement: "CONSUMO" },
      });
      expect(consumos).toBe(1);
    });

    it("check pendente adia, sem gravar fato e sem gastar tentativa", async () => {
      const generationRunId = await upToObservers();
      const revision = await prisma.siteRevision.findUniqueOrThrow({
        where: { generationRunId },
      });

      sharedFakeWorld.setChecks(fx.repository.owner, fx.repository.name, revision.commitSha!, [
        { name: "verify", status: "in_progress" },
      ]);

      const outcome = await pollChecks({ generationRunId });

      expect(outcome).toMatchObject({ type: "aguardar" });
      // A `PENDENTE` row would be a fact about nothing, and the barrier would
      // have to learn to ignore it.
      expect(
        await prisma.generationCheck.count({ where: { siteRevisionId: revision.id } }),
      ).toBe(0);
      expect(await state()).toBe("GERANDO");
    });

    it("check falhando derruba a geração e cancela o irmão vivo", async () => {
      const generationRunId = await upToObservers();
      const revision = await prisma.siteRevision.findUniqueOrThrow({
        where: { generationRunId },
      });

      sharedFakeWorld.setChecks(fx.repository.owner, fx.repository.name, revision.commitSha!, [
        { name: "verify", status: "failure" },
      ]);

      await pollChecks({ generationRunId });

      expect(await state()).toBe("FALHOU");
      const irmao = await prisma.job.findFirstOrThrow({
        where: { organizationId: fx.organizationId, kind: "preview.poll" },
      });
      expect(irmao.status).toBe("CONCLUIDO");
      expect(irmao.lastErrorCode).toBe("CHECK_FALHOU");
    });

    it("o irmão que termina depois com sucesso não reverte FALHOU", async () => {
      const generationRunId = await upToObservers();
      const revision = await prisma.siteRevision.findUniqueOrThrow({
        where: { generationRunId },
      });

      sharedFakeWorld.setChecks(fx.repository.owner, fx.repository.name, revision.commitSha!, [
        { name: "verify", status: "failure" },
      ]);
      await pollChecks({ generationRunId });
      expect(await state()).toBe("FALHOU");

      // The preview finishes afterwards, green. The conditional update requires
      // `GERANDO`, which is no longer there — so it writes nothing.
      await pollPreview({ generationRunId });

      expect(await state()).toBe("FALHOU");
      expect(
        await prisma.auditLog.count({
          where: { action: "site_project.transicao_de_sistema", entityId: fx.siteProjectId },
        }),
      ).toBe(1);
    });

    it("um fato de outro commit não fecha a geração", async () => {
      const generationRunId = await upToObservers();
      const revision = await prisma.siteRevision.findUniqueOrThrow({
        where: { generationRunId },
      });

      await pollChecks({ generationRunId });
      await pollPreview({ generationRunId });
      expect(await state()).toBe("PREVIA_PRONTA");

      // Rewriting the recorded fact to name another commit is what a stale
      // observation looks like from the barrier's side.
      await prisma.generationCheck.updateMany({
        where: { siteRevisionId: revision.id },
        data: { commitSha: "f".repeat(40) },
      });

      const { evaluateGenerationOutcome } = await import("@/lib/generation/barrier");
      const check = await prisma.generationCheck.findFirstOrThrow({
        where: { siteRevisionId: revision.id },
      });
      const decision = evaluateGenerationOutcome({
        run: { status: "CONCLUIDO", siteRevisionId: revision.id, commitSha: revision.commitSha },
        check,
        preview: null,
        requiredCheck: "verify",
      });

      expect(decision.outcome).toBe("AGUARDANDO");
    });
  });
});
