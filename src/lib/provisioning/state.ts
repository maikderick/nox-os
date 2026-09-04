import "server-only";

import { assertPermission, type Actor } from "@/lib/authz/dal";
import { AuthorizationError } from "@/lib/authz/errors";
import { prisma } from "@/lib/db";
import type { SiteFactoryDb } from "@/lib/site-factory/db-client";

import {
  describeErrorForStorage,
  formatStoredError,
  type StoredError,
} from "./error-record";

/**
 * How far provisioning has got.
 *
 * There is no queue in this phase: each step is a button a person presses, and
 * the status is what makes an interrupted run resumable — pressing again picks
 * up where it stopped instead of starting over.
 */
export const PROVISIONING_STATUSES = [
  "PENDENTE",
  "REPOSITORIO_PRONTO",
  "CONTEUDO_PRONTO",
  "HOSPEDAGEM_PRONTA",
  "PREVIA_RECONCILIADA",
  "FALHOU",
] as const;

export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

export const PROVISIONING_STATUS_LABELS: Record<ProvisioningStatus, string> = {
  PENDENTE: "Pendente",
  REPOSITORIO_PRONTO: "Repositório pronto",
  CONTEUDO_PRONTO: "Conteúdo publicado no repositório",
  HOSPEDAGEM_PRONTA: "Hospedagem pronta",
  PREVIA_RECONCILIADA: "Prévia reconciliada",
  FALHOU: "Falhou",
};

export const PROVISIONING_STEPS = [
  "repository",
  "content",
  "hosting",
  "reconcile-preview",
] as const;

export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];

export const PROVISIONING_STEP_LABELS: Record<ProvisioningStep, string> = {
  repository: "Criar repositório",
  content: "Commitar conteúdo",
  hosting: "Criar projeto de hospedagem",
  "reconcile-preview": "Reconciliar prévia",
};

/** The status a step leaves behind when it succeeds. */
const STATUS_AFTER_STEP: Record<ProvisioningStep, ProvisioningStatus> = {
  repository: "REPOSITORIO_PRONTO",
  content: "CONTEUDO_PRONTO",
  hosting: "HOSPEDAGEM_PRONTA",
  "reconcile-preview": "PREVIA_RECONCILIADA",
};

/**
 * Loads the project, scoped to the caller's organization.
 *
 * Every provisioning entry point goes through here, so a project from another
 * organization is indistinguishable from one that does not exist.
 */
export async function loadProvisionableProject(actor: Actor, siteProjectId: string) {
  const project = await prisma.siteProject.findFirst({
    where: { id: siteProjectId, organizationId: actor.organizationId },
    include: {
      client: { select: { id: true, name: true, slug: true } },
      currentBriefVersion: true,
      repository: true,
      hostingProject: true,
      provisioning: true,
    },
  });
  if (!project) throw AuthorizationError.missingPermission("provisioning:read");
  return project;
}

export async function getProvisioning(actor: Actor, siteProjectId: string) {
  assertPermission(actor, "provisioning:read");
  const project = await loadProvisionableProject(actor, siteProjectId);
  return {
    project,
    provisioning: project.provisioning,
    repository: project.repository,
    hostingProject: project.hostingProject,
  };
}

/**
 * Creates the row on first use; every step needs somewhere to record itself.
 *
 * Takes a transaction client so a step can make its completion, its status and
 * its audit entries one unit of work.
 */
export async function ensureProvisioning(siteProjectId: string, db: SiteFactoryDb = prisma) {
  return db.siteProvisioning.upsert({
    where: { siteProjectId },
    update: {},
    create: { siteProjectId },
  });
}

export async function recordStepSuccess(params: {
  siteProjectId: string;
  step: ProvisioningStep;
  data?: {
    contentSha256?: string | null;
    commitSha?: string | null;
    previewUrl?: string | null;
    previewExternalId?: string | null;
    previewCheckedAt?: Date | null;
  };
  db?: SiteFactoryDb;
}) {
  const db = params.db ?? prisma;
  await ensureProvisioning(params.siteProjectId, db);
  return db.siteProvisioning.update({
    where: { siteProjectId: params.siteProjectId },
    data: {
      status: STATUS_AFTER_STEP[params.step],
      lastStep: params.step,
      // A success clears the previous failure: leaving it would make a resumed
      // run look broken on a screen that is now correct.
      lastError: null,
      ...params.data,
    },
  });
}

/**
 * Records the failure and hands back the safe description it produced.
 *
 * Returning it matters: the caller needs the same correlation id that reached
 * the column. Describing the error a second time upstream would mint a second
 * id, and the operator reading the screen would be chasing a value that appears
 * nowhere in the log.
 */
export async function recordStepFailure(params: {
  siteProjectId: string;
  step: ProvisioningStep;
  error: unknown;
}): Promise<StoredError> {
  await ensureProvisioning(params.siteProjectId);
  // Only what this application composed itself is stored. Anything else keeps
  // a correlation id and nothing of its original text.
  const stored = describeErrorForStorage(params.error, { step: params.step });

  await prisma.siteProvisioning.update({
    where: { siteProjectId: params.siteProjectId },
    data: {
      status: "FALHOU",
      lastStep: params.step,
      lastError: formatStoredError(stored),
    },
  });

  return stored;
}

export function isProvisioningStep(value: unknown): value is ProvisioningStep {
  return typeof value === "string" && (PROVISIONING_STEPS as readonly string[]).includes(value);
}
