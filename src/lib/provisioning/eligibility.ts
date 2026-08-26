import {
  isSiteBriefV2,
  parseSiteBrief,
  type SiteBriefV2,
} from "@/lib/site-factory/brief-schema";
import { briefFactsHash } from "@/lib/site-factory/brief-service";

/** Stable codes, so a client can tell the three refusals apart. */
export const ELIGIBILITY_CODES = {
  projectNotReady: "PROJETO_NAO_ELEGIVEL",
  briefVersionTooOld: "BRIEFING_VERSAO_ANTIGA",
  briefTampered: "BRIEFING_ADULTERADO",
} as const;

export type EligibilityCode = (typeof ELIGIBILITY_CODES)[keyof typeof ELIGIBILITY_CODES];

export class ProvisioningNotEligibleError extends Error {
  readonly code: EligibilityCode;

  constructor(code: EligibilityCode, message: string) {
    super(message);
    this.name = "ProvisioningNotEligibleError";
    this.code = code;
  }
}

export type EligibleBrief = {
  brief: SiteBriefV2;
  version: number;
  factsHash: string;
};

type BriefVersionRow = {
  version: number;
  contentJson: string;
  factsHash: string;
};

type ProjectRow = {
  status: string;
  currentBriefVersion: BriefVersionRow | null;
};

/**
 * One gate, shared by every step, run before any provider is reached.
 *
 * Provisioning turns a briefing into a real repository on a real host. Three
 * things have to hold before that is allowed, and each is checked here rather
 * than in four places that could drift apart.
 */
export function assertProvisioningEligible(project: ProjectRow): EligibleBrief {
  // 1. The project is at the point in its life where provisioning makes sense.
  //    A draft is still being written; anything past the briefing has moved on
  //    to states this phase does not implement.
  if (project.status !== "BRIEFING_PRONTO") {
    throw new ProvisioningNotEligibleError(
      ELIGIBILITY_CODES.projectNotReady,
      `O projeto precisa estar em "Briefing pronto" para ser provisionado. Estado atual: ${project.status}.`,
    );
  }

  const briefVersion = project.currentBriefVersion;
  if (!briefVersion) {
    throw new ProvisioningNotEligibleError(
      ELIGIBILITY_CODES.projectNotReady,
      "O projeto não tem uma versão de briefing atual.",
    );
  }

  let parsed;
  try {
    parsed = parseSiteBrief(briefVersion.contentJson);
  } catch {
    // Unparseable stored content is tampering as far as this gate cares: the
    // row was written by a schema that accepted it, so something changed it
    // outside the application.
    throw new ProvisioningNotEligibleError(
      ELIGIBILITY_CODES.briefTampered,
      "O briefing armazenado não pode ser lido. Ele foi alterado fora do NOX OS.",
    );
  }

  // 2. Only v2 can describe a publishable site. A v1 brief names services
  //    without describing them, so generating from it would mean inventing the
  //    copy — which the whole factory exists to prevent.
  if (!isSiteBriefV2(parsed)) {
    throw new ProvisioningNotEligibleError(
      ELIGIBILITY_CODES.briefVersionTooOld,
      "Este projeto tem um briefing v1, que guarda apenas o nome de cada serviço. Crie uma versão v2 confirmando resumo, conteúdo e contato antes de provisionar.",
    );
  }

  // 3. The fingerprint still matches what was confirmed. If it does not, the
  //    stored facts are not the facts a person approved, and a site built from
  //    them would publish something nobody signed off.
  const recomputed = briefFactsHash(parsed);
  if (recomputed !== briefVersion.factsHash) {
    throw new ProvisioningNotEligibleError(
      ELIGIBILITY_CODES.briefTampered,
      "A impressão digital do briefing não confere com o conteúdo armazenado. Confirme o briefing de novo antes de provisionar.",
    );
  }

  return { brief: parsed, version: briefVersion.version, factsHash: briefVersion.factsHash };
}
