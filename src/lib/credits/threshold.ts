import "server-only";

import { prisma } from "@/lib/db";
import { dispositionFromStored } from "@/lib/generation/disposition";
import type { JobOutcome } from "@/lib/jobs/handlers";
import { isTerminalStatus } from "@/lib/jobs/kinds";

import { RESERVATION_THRESHOLD_SECONDS } from "./reserve";
import { conciliateReservation, releaseReservation } from "./settle";

/**
 * The watcher that is born with a reservation and only stops when it is settled.
 *
 * There is exactly one per reservation, its key is `credit:<reservationId>`,
 * and renewing is `deferJob` on **that same job** — never a new one. The key is
 * unique and permanent, so a second watcher for one reservation would not fit
 * the index; but the reason to renew in place is simpler than the index: a
 * second watcher would be a second thing deciding what becomes of one promise.
 *
 * Its decisions come straight from the outcome table, read through
 * `GenerationRun.startDisposition`:
 *
 *   * already settled → stop, without renewing;
 *   * `INICIADO` with the run still going → renew;
 *   * `NAO_TENTADO` or `SEM_EFEITO_COMPROVADO` with the job still alive →
 *     **renew too**, because the reservation survives a safe retry;
 *   * the same dispositions with the job already terminal → release, which is
 *     the only place a release is authorised: those two dispositions are the
 *     ones that prove nothing was ever called;
 *   * `EM_TENTATIVA` or `AMBIGUO` → block the account and go to conciliation.
 *
 * **Nothing here releases without proof that no paid call happened.** That is
 * the single rule the whole module is arranged around.
 */

export type WatchThresholdParams = {
  reservationId: string;
};

type Watched = {
  id: string;
  status: string;
  generationRunId: string | null;
  runStartDisposition: string | null;
  runStatus: string | null;
  /** The `generation.start` job for that run, if one still exists. */
  startJobStatus: string | null;
};

async function load(reservationId: string): Promise<Watched | null> {
  const reservation = await prisma.creditReservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      status: true,
      generationRunId: true,
      generationRun: {
        select: {
          id: true,
          status: true,
          startDisposition: true,
          jobs: {
            where: { kind: "generation.start" },
            select: { status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!reservation) return null;

  return {
    id: reservation.id,
    status: reservation.status,
    generationRunId: reservation.generationRunId,
    runStartDisposition: reservation.generationRun?.startDisposition ?? null,
    runStatus: reservation.generationRun?.status ?? null,
    startJobStatus: reservation.generationRun?.jobs[0]?.status ?? null,
  };
}

export async function watchReservationThreshold(
  params: WatchThresholdParams,
): Promise<JobOutcome> {
  const watched = await load(params.reservationId);

  // A reservation that no longer exists cannot be watched, and a watcher that
  // outlived its subject has nothing left to decide.
  if (!watched) return { type: "concluido" };

  // Already consumed, released or under conciliation. The watcher stops without
  // renewing: something else settled it, which is exactly what it was waiting
  // for.
  if (watched.status !== "RESERVADA") return { type: "concluido" };

  // No run attached — a reservation for something that never named its work.
  // Nothing proves a call happened, but nothing proves one did not either, and
  // the strict reading is the only safe one.
  if (!watched.generationRunId) {
    await prisma.$transaction(async (tx) => {
      await conciliateReservation(tx, {
        reservationId: watched.id,
        reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
      });
    });
    return { type: "concluido" };
  }

  const disposition = dispositionFromStored(watched.runStartDisposition);

  // Ambiguity is a person's problem, durably. Renewing would be waiting for an
  // answer nobody is going to produce, and releasing would refund a call that
  // may have happened.
  if (disposition === "EM_TENTATIVA" || disposition === "AMBIGUO") {
    await prisma.$transaction(async (tx) => {
      await conciliateReservation(tx, {
        reservationId: watched.id,
        reasonCode: "EFEITO_AMBIGUO_NA_GERACAO",
      });
    });
    return { type: "concluido" };
  }

  // The run is confirmed in flight. It is allowed to take longer than the
  // threshold — a two-hour generation is a long generation, not a lost one.
  if (disposition === "INICIADO") {
    return { type: "aguardar", delaySeconds: RESERVATION_THRESHOLD_SECONDS };
  }

  // `NAO_TENTADO` and `SEM_EFEITO_COMPROVADO`: proved that nothing was called.
  // What decides between renewing and releasing is whether anyone is still
  // going to try.
  const stillTrying =
    watched.startJobStatus !== null && !isTerminalStatus(watched.startJobStatus);

  if (stillTrying) {
    // The reservation crosses the safe retry. Releasing and re-reserving would
    // open a window for another generation to take the credit, create a second
    // watcher for one intention, and fill the ledger with release/reserve pairs
    // describing no movement.
    return { type: "aguardar", delaySeconds: RESERVATION_THRESHOLD_SECONDS };
  }

  // Nobody is going to try again, and it is proved that nothing was ever
  // called. This is the one release in the whole phase.
  await prisma.$transaction(async (tx) => {
    await releaseReservation(tx, { reservationId: watched.id });
    if (watched.runStatus !== "FALHOU" && watched.runStatus !== "CONCLUIDO") {
      await tx.generationRun.update({
        where: { id: watched.generationRunId! },
        data: { status: "FALHOU", finishedAt: new Date() },
      });
    }
  });

  return { type: "concluido" };
}
