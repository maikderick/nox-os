import "server-only";

import type { Job } from "@prisma/client";

import { type Actor, assertPermission } from "@/lib/authz/dal";
import { consumeReservation, releaseReservation, settleConciliatedReservation } from "@/lib/credits/settle";
import { prisma } from "@/lib/db";
import { enqueueJob, type JobTransaction } from "@/lib/jobs/outbox";
import { writeAudit } from "@/lib/settings";

export const CONCILIATION_DECISIONS = [
  "EFEITO_CONFIRMADO",
  "SEM_EFEITO_CONFIRMADO",
  "DESCARTAR",
] as const;

export type ConciliationDecision = (typeof CONCILIATION_DECISIONS)[number];

export class ConciliationRefusal extends Error {
  readonly code:
    | "DECISAO_INVALIDA"
    | "JOB_NAO_CONCILIAVEL"
    | "EFEITO_NAO_ADOTAVEL"
    | "IDENTIFICADOR_EXTERNO_INVALIDO"
    | "RESERVA_JA_LIBERADA";

  constructor(code: ConciliationRefusal["code"], message: string) {
    super(message);
    this.name = "ConciliationRefusal";
    this.code = code;
  }
}

export function isConciliationDecision(value: unknown): value is ConciliationDecision {
  return (
    typeof value === "string" &&
    (CONCILIATION_DECISIONS as readonly string[]).includes(value)
  );
}

export async function listOrganizationJobs(actor: Actor, limit = 100) {
  assertPermission(actor, "job:read");
  const take = Math.max(1, Math.min(limit, 200));

  return prisma.job.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take,
    include: {
      siteProject: { select: { id: true, name: true } },
      generationRun: {
        select: {
          id: true,
          status: true,
          startDisposition: true,
          providerRunId: true,
          reservation: {
            select: { id: true, status: true, amountCents: true },
          },
        },
      },
    },
  });
}

function assertProviderRunId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new ConciliationRefusal(
      "IDENTIFICADOR_EXTERNO_INVALIDO",
      "Informe o identificador exato da execução externa, sem espaços.",
    );
  }
}

async function settleReservation(
  tx: JobTransaction,
  reservation: { id: string; status: string; amountCents: number } | null,
  settlement: "CONSUMIR" | "LIBERAR",
  actorId: string,
): Promise<void> {
  if (!reservation) return;
  if (reservation.status === "CONCILIACAO") {
    await settleConciliatedReservation(tx, {
      reservationId: reservation.id,
      settlement,
      actorId,
    });
    return;
  }
  if (reservation.status === "RESERVADA") {
    if (settlement === "CONSUMIR") {
      await consumeReservation(tx, {
        reservationId: reservation.id,
        actualCents: reservation.amountCents,
        actorId,
      });
    } else {
      await releaseReservation(tx, { reservationId: reservation.id, actorId });
    }
    return;
  }
  if (settlement === "CONSUMIR" && reservation.status === "LIBERADA") {
    throw new ConciliationRefusal(
      "RESERVA_JA_LIBERADA",
      "A reserva já foi liberada; não é possível confirmar cobrança para este job.",
    );
  }
}

export async function resolveJobConciliation(params: {
  actor: Actor;
  jobId: string;
  decision: ConciliationDecision;
  providerRunId?: string;
}) {
  assertPermission(params.actor, "job:run");
  if (!isConciliationDecision(params.decision)) {
    throw new ConciliationRefusal("DECISAO_INVALIDA", "Escolha uma decisão de conciliação válida.");
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Job[]>`
      SELECT *
        FROM "Job"
       WHERE "id" = ${params.jobId}
         AND "organizationId" = ${params.actor.organizationId}
         AND "status" = 'CONCILIACAO'
       FOR UPDATE
    `;
    const job = locked[0];
    if (!job) {
      throw new ConciliationRefusal(
        "JOB_NAO_CONCILIAVEL",
        "O job não existe nesta organização ou já saiu da conciliação.",
      );
    }

    const run = job.generationRunId
      ? await tx.generationRun.findFirst({
          where: {
            id: job.generationRunId,
            siteProject: { organizationId: params.actor.organizationId },
          },
          include: { reservation: true },
        })
      : null;

    const now = new Date();
    let replacementRunId: string | null = null;

    if (params.decision === "EFEITO_CONFIRMADO") {
      // Only the start handoff can be reconstructed from one closed fact plus
      // the provider run id. Checks and previews need their own commit-bound
      // evidence; accepting a generic confirmation for them would fabricate it.
      if (!run || job.kind !== "generation.start") {
        throw new ConciliationRefusal(
          "EFEITO_NAO_ADOTAVEL",
          "Este tipo de job exige evidência ligada ao commit. Descarte-o ou confirme que não houve efeito e inicie uma nova geração.",
        );
      }
      const providerRunId = params.providerRunId ?? run.providerRunId;
      assertProviderRunId(providerRunId);
      await settleReservation(tx, run.reservation, "CONSUMIR", params.actor.userId);
      await tx.generationRun.update({
        where: { id: run.id },
        data: {
          status: "EXECUTANDO",
          startDisposition: "INICIADO",
          providerRunId,
          startedAt: run.startedAt ?? now,
          errorMessage: null,
        },
      });
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: "CONCLUIDO",
          finishedAt: now,
          lastErrorCode: "CONCILIACAO_EFEITO_CONFIRMADO",
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await enqueueJob(tx, {
        organizationId: params.actor.organizationId,
        step: { kind: "generation.poll", generationRunId: run.id },
      });
    } else if (params.decision === "SEM_EFEITO_CONFIRMADO") {
      if (!run) {
        throw new ConciliationRefusal(
          "EFEITO_NAO_ADOTAVEL",
          "Este job não está ligado a uma geração que possa ser iniciada de novo.",
        );
      }
      await settleReservation(tx, run.reservation, "LIBERAR", params.actor.userId);
      await tx.job.updateMany({
        where: {
          generationRunId: run.id,
          status: { in: ["PENDENTE", "EM_EXECUCAO", "PAUSADO", "CONCILIACAO"] },
        },
        data: {
          status: "FALHOU",
          finishedAt: now,
          lastErrorCode: "CONCILIACAO_SEM_EFEITO",
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await tx.generationRun.update({
        where: { id: run.id },
        data: {
          status: "CANCELADO",
          finishedAt: now,
          startDisposition: "SEM_EFEITO_COMPROVADO",
          errorMessage: "Conciliação confirmou que a execução externa não ocorreu.",
        },
      });
      const replacement = await tx.generationRun.create({
        data: {
          siteProjectId: run.siteProjectId,
          briefVersionId: run.briefVersionId,
          provider: run.provider,
          status: "PENDENTE",
          requestJson: run.requestJson,
          requestedById: params.actor.userId,
        },
      });
      replacementRunId = replacement.id;
      await tx.siteProject.update({
        where: { id: run.siteProjectId },
        data: { status: "GERANDO", statusMessage: null },
      });
      await enqueueJob(tx, {
        organizationId: params.actor.organizationId,
        step: {
          kind: "generation.start",
          generationRunId: replacement.id,
          siteProjectId: run.siteProjectId,
        },
      });
    } else {
      if (run) {
        // Discarding an ambiguous result does not prove it was free. Consume
        // conservatively and close the run without claiming a usable revision.
        await settleReservation(tx, run.reservation, "CONSUMIR", params.actor.userId);
        await tx.job.updateMany({
          where: {
            generationRunId: run.id,
            status: { in: ["PENDENTE", "EM_EXECUCAO", "PAUSADO", "CONCILIACAO"] },
          },
          data: {
            status: "FALHOU",
            finishedAt: now,
            lastErrorCode: "CONCILIACAO_DESCARTADA",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        await tx.generationRun.update({
          where: { id: run.id },
          data: {
            status: "CANCELADO",
            finishedAt: now,
            errorMessage: "Resultado ambíguo descartado por decisão administrativa.",
          },
        });
        await tx.siteProject.updateMany({
          where: { id: run.siteProjectId, status: "GERANDO" },
          data: {
            status: "FALHOU",
            statusMessage: "Geração encerrada por conciliação administrativa.",
          },
        });
      } else {
        await tx.job.update({
          where: { id: job.id },
          data: {
            status: "FALHOU",
            finishedAt: now,
            lastErrorCode: "CONCILIACAO_DESCARTADA",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
    }

    await writeAudit({
      db: tx,
      userId: params.actor.userId,
      action: "job.conciliacao.resolvida",
      entity: "Job",
      entityId: job.id,
      meta: {
        organizationId: params.actor.organizationId,
        kind: job.kind,
        decision: params.decision,
        generationRunId: run?.id ?? null,
        replacementRunId,
      },
    });

    return {
      jobId: job.id,
      decision: params.decision,
      generationRunId: run?.id ?? null,
      replacementRunId,
    };
  });
}
