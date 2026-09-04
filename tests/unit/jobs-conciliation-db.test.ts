import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import type { Actor } from "@/lib/authz/dal";
import { permissionsForRole } from "@/lib/authz/permissions";
import { conciliateReservation } from "@/lib/credits/settle";
import { reserveCredits } from "@/lib/credits/reserve";
import { prisma } from "@/lib/db";
import { resolveJobConciliation } from "@/lib/jobs/conciliation";
import { enqueueJob } from "@/lib/jobs/outbox";

import { describeLocalDatabase } from "../helpers/jobs-fixtures";

const organizations: string[] = [];
const users: string[] = [];

afterEach(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizations.splice(0) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});

async function fixture(role: "ADMIN" | "OPERADOR" = "ADMIN") {
  const token = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `conciliacao-${token}@example.test`,
      name: "Responsável pela conciliação",
      passwordHash: "nao-usado",
      role: "admin",
    },
  });
  users.push(user.id);
  const organization = await prisma.organization.create({
    data: { name: `Conciliação ${token}`, slug: `conciliacao-${token}` },
  });
  organizations.push(organization.id);
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: "ADMIN" },
  });
  const client = await prisma.client.create({
    data: { organizationId: organization.id, name: "Cliente", slug: `cliente-${token}` },
  });
  const project = await prisma.siteProject.create({
    data: {
      organizationId: organization.id,
      clientId: client.id,
      name: "Projeto",
      slug: `projeto-${token}`,
      status: "GERANDO",
    },
  });
  const brief = await prisma.siteBriefVersion.create({
    data: {
      siteProjectId: project.id,
      version: 1,
      contentJson: JSON.stringify({ versao: 2 }),
      factsHash: "teste",
    },
  });
  await prisma.siteProject.update({
    where: { id: project.id },
    data: { currentBriefVersionId: brief.id },
  });
  const run = await prisma.generationRun.create({
    data: {
      siteProjectId: project.id,
      briefVersionId: brief.id,
      provider: "cursor",
      requestJson: JSON.stringify({ siteProjectId: project.id }),
      startDisposition: "AMBIGUO",
    },
  });
  await prisma.creditAccount.create({
    data: {
      organizationId: organization.id,
      balanceCents: 10_000,
      monthlyCapCents: 10_000,
      generationPriceCents: 100,
    },
  });
  const startJob = await prisma.$transaction((tx) =>
    enqueueJob(tx, {
      organizationId: organization.id,
      step: { kind: "generation.start", generationRunId: run.id, siteProjectId: project.id },
    }),
  );
  const reservation = await prisma.$transaction((tx) =>
    reserveCredits(tx, {
      organizationId: organization.id,
      operationKey: `generation:${run.id}`,
      amountCents: 100,
      estimatedBy: "PRECO_DA_ORGANIZACAO",
      generationRunId: run.id,
    }),
  );
  await prisma.$transaction((tx) =>
    conciliateReservation(tx, {
      reservationId: reservation.id,
      reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
    }),
  );
  await prisma.job.update({ where: { id: startJob.id }, data: { status: "CONCILIACAO" } });

  const actor: Actor = {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    membershipId: membership.id,
    role,
    permissions: permissionsForRole(role),
  };
  return { actor, organization, project, run, startJob, reservation };
}

describeLocalDatabase("closed job conciliation decisions", () => {
  it("adopts a confirmed external start, consumes credit, audits and hands off", async () => {
    const fx = await fixture();
    await resolveJobConciliation({
      actor: fx.actor,
      jobId: fx.startJob.id,
      decision: "EFEITO_CONFIRMADO",
      providerRunId: "cursor-run-confirmed-1",
    });

    const [job, run, reservation, account, poll, audits] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: fx.startJob.id } }),
      prisma.generationRun.findUniqueOrThrow({ where: { id: fx.run.id } }),
      prisma.creditReservation.findUniqueOrThrow({ where: { id: fx.reservation.id } }),
      prisma.creditAccount.findUniqueOrThrow({ where: { organizationId: fx.organization.id } }),
      prisma.job.findFirst({ where: { generationRunId: fx.run.id, kind: "generation.poll" } }),
      prisma.auditLog.count({ where: { userId: fx.actor.userId, action: "job.conciliacao.resolvida" } }),
    ]);
    expect(job.status).toBe("CONCLUIDO");
    expect(run).toMatchObject({ status: "EXECUTANDO", startDisposition: "INICIADO", providerRunId: "cursor-run-confirmed-1" });
    expect(reservation).toMatchObject({ status: "CONSUMIDA", reconciledById: fx.actor.userId });
    expect(account).toMatchObject({ balanceCents: 9_900, reservedCents: 0, blockedAt: null });
    expect(poll?.status).toBe("PENDENTE");
    expect(audits).toBe(1);
  });

  it("releases proven no-effect credit and enqueues a distinct replacement run", async () => {
    const fx = await fixture();
    const result = await resolveJobConciliation({
      actor: fx.actor,
      jobId: fx.startJob.id,
      decision: "SEM_EFEITO_CONFIRMADO",
    });

    expect(result.replacementRunId).toBeTruthy();
    expect(result.replacementRunId).not.toBe(fx.run.id);
    expect(await prisma.generationRun.findUniqueOrThrow({ where: { id: fx.run.id } })).toMatchObject({ status: "CANCELADO", startDisposition: "SEM_EFEITO_COMPROVADO" });
    expect(await prisma.creditReservation.findUniqueOrThrow({ where: { id: fx.reservation.id } })).toMatchObject({ status: "LIBERADA", reconciledById: fx.actor.userId });
    expect(await prisma.job.findFirst({ where: { generationRunId: result.replacementRunId!, kind: "generation.start" } })).toMatchObject({ status: "PENDENTE" });
  });

  it("discards conservatively without claiming a usable result", async () => {
    const fx = await fixture();
    await resolveJobConciliation({ actor: fx.actor, jobId: fx.startJob.id, decision: "DESCARTAR" });

    expect(await prisma.job.findUniqueOrThrow({ where: { id: fx.startJob.id } })).toMatchObject({ status: "FALHOU", lastErrorCode: "CONCILIACAO_DESCARTADA" });
    expect(await prisma.generationRun.findUniqueOrThrow({ where: { id: fx.run.id } })).toMatchObject({ status: "CANCELADO" });
    expect(await prisma.siteProject.findUniqueOrThrow({ where: { id: fx.project.id } })).toMatchObject({ status: "FALHOU" });
    expect(await prisma.creditReservation.findUniqueOrThrow({ where: { id: fx.reservation.id } })).toMatchObject({ status: "CONSUMIDA" });
  });

  it("writes nothing without job:run", async () => {
    const fx = await fixture("OPERADOR");
    await expect(resolveJobConciliation({ actor: fx.actor, jobId: fx.startJob.id, decision: "DESCARTAR" })).rejects.toMatchObject({ status: 403 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: fx.startJob.id } })).toMatchObject({ status: "CONCILIACAO" });
    expect(await prisma.auditLog.count({ where: { userId: fx.actor.userId } })).toBe(0);
  });
});
