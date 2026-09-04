import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { requestGeneration } from "@/lib/generation/request";
import { isGenerationRefusal } from "@/lib/generation/reasons";
import { SITE_PROJECT_TRANSITIONS, statesWithTransitionTo } from "@/lib/site-factory/states";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * Asking for a generation, and the two locks that make asking twice safe.
 *
 * The idempotency key is the client's, and the conditional update on the
 * project's state is what settles a race between two different keys. They guard
 * different things: the key stops a network retry from generating twice, the
 * state stops two deliberate intentions from generating at once.
 */
describeLocalDatabase("pedido de geração", () => {
  let fx: GenerationFixture;

  beforeEach(async () => {
    fx = await createGenerationFixture();
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  it("cria run, transição e job juntos", async () => {
    const result = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: randomUUID(),
    });

    const run = await prisma.generationRun.findUniqueOrThrow({
      where: { id: result.generationRunId },
    });
    const project = await prisma.siteProject.findUniqueOrThrow({
      where: { id: fx.siteProjectId },
    });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId } });

    expect(result.executed).toBe(true);
    expect(run.status).toBe("PENDENTE");
    // Nothing has been called, so the disposition says exactly that.
    expect(run.startDisposition).toBe("NAO_TENTADO");
    expect(project.status).toBe("GERANDO");
    expect(job.kind).toBe("generation.start");
    expect(job.concurrencyKey).toBe(`project:${fx.siteProjectId}`);
  });

  it("sem chave de idempotência, nada é escrito em lugar nenhum", async () => {
    const before = await prisma.generationRun.count({
      where: { siteProjectId: fx.siteProjectId },
    });

    const error = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: "retry",
    }).catch((thrown: unknown) => thrown);

    expect(isGenerationRefusal(error)).toBe(true);
    expect((error as { code: string }).code).toBe("CHAVE_DE_REQUISICAO_INVALIDA");
    expect(
      await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } }),
    ).toBe(before);
    expect(
      (await prisma.siteProject.findUniqueOrThrow({ where: { id: fx.siteProjectId } })).status,
    ).toBe("BRIEFING_PRONTO");
  });

  it("mesma chave e mesmo corpo devolvem o mesmo run, sem escrever de novo", async () => {
    const key = randomUUID();
    const first = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: key,
    });
    const second = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: key,
    });

    expect(second.generationRunId).toBe(first.generationRunId);
    expect(second.jobId).toBe(first.jobId);
    // The whole point: the second call was answered from the recorded response.
    expect(second.executed).toBe(false);
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(1);
  });

  it("mesma chave com corpo diferente é recusada, e o primeiro run fica intacto", async () => {
    const key = randomUUID();
    const first = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: key,
    });

    const other = await createGenerationFixture();
    const error = await requestGeneration({
      actor: fx.actor,
      siteProjectId: other.siteProjectId,
      idempotencyKey: key,
    }).catch((thrown: unknown) => thrown);

    expect((error as { code?: string }).code).toBe("CORPO_DIVERGENTE");
    await expect(
      prisma.generationRun.findUniqueOrThrow({ where: { id: first.generationRunId } }),
    ).resolves.toMatchObject({ siteProjectId: fx.siteProjectId });
  });

  it("duas chaves diferentes: só uma vence a atualização condicional", async () => {
    // Two deliberate intentions arriving together. The key cannot separate
    // them — they are genuinely different requests — so the state has to.
    const [first, second] = await Promise.allSettled([
      requestGeneration({
        actor: fx.actor,
        siteProjectId: fx.siteProjectId,
        idempotencyKey: randomUUID(),
      }),
      requestGeneration({
        actor: fx.actor,
        siteProjectId: fx.siteProjectId,
        idempotencyKey: randomUUID(),
      }),
    ]);

    const settled = [first, second];
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // No orphan: the loser's run rolled back with its transaction.
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(1);
    expect(
      await prisma.job.count({
        where: { concurrencyKey: `project:${fx.siteProjectId}` },
      }),
    ).toBe(1);
    expect(await prisma.creditReservation.count({ where: { organizationId: fx.organizationId } })).toBe(0);
  });

  it("chave nova, mesmo briefing, depois de um run terminal: geração nova", async () => {
    await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: randomUUID(),
    });

    // The chain finished and left the project somewhere a new generation may
    // start from.
    await prisma.job.updateMany({
      where: { concurrencyKey: `project:${fx.siteProjectId}` },
      data: { status: "CONCLUIDO" },
    });
    await prisma.siteProject.update({
      where: { id: fx.siteProjectId },
      data: { status: "PREVIA_PRONTA" },
    });

    const again = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: randomUUID(),
    });

    expect(again.executed).toBe(true);
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(2);
  });

  it("todo estado com transição autorizada para GERANDO entra; os outros são recusados pelo estado", async () => {
    // Both lists come from the state machine, so this test breaks on purpose if
    // the machine changes — which is the only way to keep them from diverging.
    const allowed = statesWithTransitionTo("GERANDO");
    const everyState = [...new Set(SITE_PROJECT_TRANSITIONS.flatMap((t) => [t.from, t.to]))];
    const refused = everyState.filter((state) => !allowed.includes(state));

    expect(allowed).toEqual(
      expect.arrayContaining(["BRIEFING_PRONTO", "PREVIA_PRONTA", "EM_REVISAO", "PUBLICADO", "FALHOU"]),
    );
    expect(refused).toEqual(
      expect.arrayContaining(["RASCUNHO", "APROVADO", "PUBLICANDO", "GERANDO"]),
    );

    for (const state of refused) {
      const project = await createGenerationFixture({ status: state });
      const error = await requestGeneration({
        actor: project.actor,
        siteProjectId: project.siteProjectId,
        idempotencyKey: randomUUID(),
      }).catch((thrown: unknown) => thrown);

      expect((error as { code?: string }).code).toBe("PROJETO_NAO_ELEGIVEL");
    }
  });

  it("recusa um projeto de outra organização como se não existisse", async () => {
    const error = await requestGeneration({
      actor: fx.otherActor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: randomUUID(),
    }).catch((thrown: unknown) => thrown);

    expect((error as { code?: string }).code).toBe("PROJETO_NAO_ELEGIVEL");
  });

  it("recusa quem não tem generation:run antes de gastar a chave", async () => {
    const reader = { ...fx.actor, role: "LEITOR" as const, permissions: [] };
    const key = randomUUID();

    await expect(
      requestGeneration({ actor: reader, siteProjectId: fx.siteProjectId, idempotencyKey: key }),
    ).rejects.toMatchObject({ status: 403 });

    // The key was not burned: the authorised caller may still use it.
    const ok = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: key,
    });
    expect(ok.executed).toBe(true);
  });

  it("falha ao enfileirar desfaz o run e a transição", async () => {
    const error = await requestGeneration({
      actor: fx.actor,
      siteProjectId: fx.siteProjectId,
      idempotencyKey: randomUUID(),
      enqueue: async () => {
        throw new Error("falha proposital no outbox");
      },
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(await prisma.generationRun.count({ where: { siteProjectId: fx.siteProjectId } })).toBe(0);
    expect(
      (await prisma.siteProject.findUniqueOrThrow({ where: { id: fx.siteProjectId } })).status,
    ).toBe("BRIEFING_PRONTO");
  });
});
