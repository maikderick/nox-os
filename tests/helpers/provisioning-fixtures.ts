import { siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { briefFactsHash } from "@/lib/site-factory/brief-service";

/**
 * A project that provisioning would actually accept.
 *
 * The brief and its fingerprint are produced by the same code the application
 * uses, so a test cannot pass with a hand-written hash that the real gate would
 * reject.
 */

const CONFIRMED_AT = "2026-08-25T12:00:00.000-03:00";

export const fact = (value: string) => ({
  value,
  source: "OPERADOR" as const,
  confirmedAt: CONFIRMED_AT,
});

export const BRIEF_V2_INPUT = {
  schemaVersion: 2,
  businessName: fact("Oficina Demonstração NOX"),
  sector: fact("Manutenção residencial"),
  city: fact("São Paulo"),
  objective: fact("Apresentar os serviços de manutenção residencial e receber contatos."),
  audience: fact("Moradores e pequenos comércios da região central."),
  positioning: fact(
    "Serviços de manutenção residencial planejados e executados por equipe própria, com atendimento agendado.",
  ),
  differentiators: [fact("Atendimento agendado")],
  desiredSections: ["inicio", "sobre", "servicos", "contato"],
  visualDirection: fact("Visual limpo, com foco em leitura e contraste alto."),
  notes: null,
  services: [
    {
      id: "reparos-hidraulicos",
      name: fact("Reparos hidráulicos"),
      summary: fact("Conserto de vazamentos, torneiras e registros em pontos internos."),
      body: [
        fact("Avaliamos o ponto afetado e executamos o reparo na mesma visita quando há peça."),
      ],
      featured: true,
      relatedIds: [],
    },
  ],
  publicContact: {},
};

export const BRIEF_V1_INPUT = {
  schemaVersion: 1,
  businessName: fact("Oficina Demonstração NOX"),
  sector: fact("Manutenção residencial"),
  city: fact("São Paulo"),
  objective: fact("Apresentar os serviços de manutenção residencial e receber contatos."),
  audience: fact("Moradores e pequenos comércios da região central."),
  positioning: fact(
    "Serviços de manutenção residencial planejados e executados por equipe própria, com atendimento agendado.",
  ),
  differentiators: [fact("Atendimento agendado")],
  desiredSections: ["inicio", "contato"],
  visualDirection: fact("Visual limpo, com foco em leitura e contraste alto."),
  notes: null,
  services: [fact("Reparos hidráulicos")],
};

/** Stores exactly what `createSiteBriefVersion` would have stored. */
export function briefVersionRow(
  input: unknown = BRIEF_V2_INPUT,
  overrides: { version?: number; createdAt?: Date; factsHash?: string } = {},
) {
  const parsed = siteBriefSchema.parse(input);
  return {
    id: "brief-1",
    version: overrides.version ?? 2,
    contentJson: JSON.stringify(parsed),
    factsHash: overrides.factsHash ?? briefFactsHash(parsed),
    createdAt: overrides.createdAt ?? new Date("2026-08-25T15:00:00.000Z"),
  };
}

export const REPO_ROW = {
  owner: "nox-sites-falso",
  name: "site-oficina",
  externalId: "repo_1",
  url: "https://github.example/nox-sites-falso/site-oficina",
  defaultBranch: "main",
  protectedAt: new Date("2026-08-25T15:10:00.000Z"),
};

export function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Site Oficina",
    slug: "site-oficina",
    status: "BRIEFING_PRONTO",
    client: { id: "client-1", name: "Oficina", slug: "oficina" },
    currentBriefVersion: briefVersionRow(),
    repository: null,
    hostingProject: null,
    provisioning: null,
    ...overrides,
  };
}
