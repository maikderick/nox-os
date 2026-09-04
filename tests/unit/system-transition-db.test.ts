import { afterEach, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { applySystemTransition } from "@/lib/site-factory/system-transition";
import { SiteProjectTransitionError } from "@/lib/site-factory/states";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";
import {
  createGenerationFixture,
  dropCreatedGenerationFixtures,
  type GenerationFixture,
} from "../helpers/generation-fixtures";

/**
 * The transition the orchestration reports, and the race it has to lose safely.
 *
 * The conditional update is the whole mechanism: whoever finds the project in
 * the state being left writes it and audits it; whoever does not writes nothing
 * at all.
 */
describeLocalDatabase("transição de sistema", () => {
  let fx: GenerationFixture;

  beforeEach(async () => {
    fx = await createGenerationFixture({ status: "GERANDO" });
  });

  // The queue is global: a `PENDENTE` job left here is a job the next
  // suite's consumer claims. Everything this suite created goes away.
  afterEach(dropCreatedGenerationFixtures);

  const audits = async () =>
    prisma.auditLog.findMany({
      where: { action: "site_project.transicao_de_sistema", entityId: fx.siteProjectId },
    });

  const status = async () =>
    (await prisma.siteProject.findUniqueOrThrow({ where: { id: fx.siteProjectId } })).status;

  it("aplica e audita na mesma transação", async () => {
    const result = await prisma.$transaction((tx) =>
      applySystemTransition(tx, {
        siteProjectId: fx.siteProjectId,
        from: "GERANDO",
        to: "PREVIA_PRONTA",
        reasonCode: "TRES_FATOS_ALINHADOS",
      }),
    );

    expect(result).toEqual({ applied: true, status: "PREVIA_PRONTA" });
    expect(await status()).toBe("PREVIA_PRONTA");
    expect(await audits()).toHaveLength(1);
  });

  it("recusa uma transição que uma pessoa poderia pedir", async () => {
    // `EM_REVISAO` carries a permission, so it is a person's to request. The
    // orchestration applying it would be moving a project behind their back.
    await prisma.siteProject.update({
      where: { id: fx.siteProjectId },
      data: { status: "PREVIA_PRONTA" },
    });

    await expect(
      prisma.$transaction((tx) =>
        applySystemTransition(tx, {
          siteProjectId: fx.siteProjectId,
          from: "PREVIA_PRONTA",
          to: "EM_REVISAO",
          reasonCode: "SEJA_LA_O_QUE_FOR",
        }),
      ),
    ).rejects.toBeInstanceOf(SiteProjectTransitionError);

    expect(await status()).toBe("PREVIA_PRONTA");
    expect(await audits()).toHaveLength(0);
  });

  it("recusa uma transição que a máquina de estados não tem", async () => {
    await expect(
      prisma.$transaction((tx) =>
        applySystemTransition(tx, {
          siteProjectId: fx.siteProjectId,
          from: "GERANDO",
          to: "PUBLICADO",
          reasonCode: "INVENTADA",
        }),
      ),
    ).rejects.toBeInstanceOf(SiteProjectTransitionError);
  });

  it("o segundo a chegar não escreve nada, e devolve o estado terminal", async () => {
    await prisma.$transaction((tx) =>
      applySystemTransition(tx, {
        siteProjectId: fx.siteProjectId,
        from: "GERANDO",
        to: "FALHOU",
        reasonCode: "CHECK_FALHOU",
      }),
    );

    // The sibling arrives afterwards with a success. The condition requires
    // `GERANDO`, which is no longer there — there is no path back from
    // `FALHOU` to `PREVIA_PRONTA`.
    const late = await prisma.$transaction((tx) =>
      applySystemTransition(tx, {
        siteProjectId: fx.siteProjectId,
        from: "GERANDO",
        to: "PREVIA_PRONTA",
        reasonCode: "TRES_FATOS_ALINHADOS",
      }),
    );

    expect(late).toEqual({ applied: false, status: "FALHOU" });
    expect(await status()).toBe("FALHOU");
    // One transition, one audit line, however many observers reported.
    expect(await audits()).toHaveLength(1);
  });

  it("a auditoria cai junto quando a transação falha", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await applySystemTransition(tx, {
          siteProjectId: fx.siteProjectId,
          from: "GERANDO",
          to: "PREVIA_PRONTA",
          reasonCode: "TRES_FATOS_ALINHADOS",
        });
        throw new Error("falha proposital depois da transição");
      }),
    ).rejects.toThrow(/proposital/);

    expect(await status()).toBe("GERANDO");
    expect(await audits()).toHaveLength(0);
  });
});
