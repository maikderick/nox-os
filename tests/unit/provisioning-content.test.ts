import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRole } from "../../src/lib/authz/permissions";
import { sharedFakeWorld } from "../../src/lib/providers/fake/fake-world";

const modeBox = vi.hoisted(() => ({ mode: "FALSO" as string }));

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  settingsFindUnique: vi.fn(),
  provUpsert: vi.fn(),
  provUpdate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/integrations/settings-service", () => ({
  getEffectiveMode: async () => modeBox.mode,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    siteProject: { findFirst: mocks.projectFindFirst },
    appSettings: { findUnique: mocks.settingsFindUnique },
    siteProvisioning: { upsert: mocks.provUpsert, update: mocks.provUpdate },
    auditLog: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

const { CONTENT_PATH, MANIFEST_PATH, provisionContent } = await import(
  "../../src/lib/provisioning/step-content"
);
const { createFakeGitRepositoryProvider } = await import(
  "../../src/lib/providers/fake/fake-git"
);

const CONFIRMED_AT = "2026-08-25T12:00:00.000-03:00";
const fact = (value: string) => ({ value, source: "OPERADOR" as const, confirmedAt: CONFIRMED_AT });

const BRIEF_V2 = {
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
      body: [fact("Avaliamos o ponto afetado e executamos o reparo na mesma visita quando há peça.")],
      featured: true,
      relatedIds: [],
    },
  ],
  publicContact: {},
};

const admin = {
  userId: "user-1",
  email: "a@b.test",
  name: "Pessoa",
  organizationId: "org-1",
  organizationSlug: "nox-os",
  organizationName: "NOX OS",
  membershipId: "m-1",
  role: "ADMIN" as const,
  permissions: permissionsForRole("ADMIN"),
};

const REPO = {
  owner: "nox-sites-falso",
  name: "site-oficina",
  externalId: "repo_1",
  url: "https://github.example/nox-sites-falso/site-oficina",
  defaultBranch: "main",
};

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Site Oficina",
    slug: "site-oficina",
    client: { id: "client-1", name: "Oficina", slug: "oficina" },
    currentBriefVersion: {
      id: "brief-1",
      version: 2,
      contentJson: JSON.stringify(BRIEF_V2),
      factsHash: "a".repeat(64),
      createdAt: new Date("2026-08-25T15:00:00.000Z"),
    },
    repository: REPO,
    hostingProject: null,
    provisioning: null,
    ...overrides,
  };
}

async function seedRepository() {
  const git = createFakeGitRepositoryProvider({ world: sharedFakeWorld });
  await git.createFromTemplate({
    owner: REPO.owner,
    name: REPO.name,
    templateOwner: "maikderick",
    templateRepo: "nox-site-template",
  });
}

describe("provisioning step 2 — content", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sharedFakeWorld.reset();
    modeBox.mode = "FALSO";
    mocks.projectFindFirst.mockResolvedValue(projectRow());
    mocks.settingsFindUnique.mockResolvedValue({
      brandName: "NOX OS",
      privacyEmail: "privacidade@noxos.test",
      updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    mocks.provUpsert.mockResolvedValue({});
    mocks.provUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    await seedRepository();
  });

  it("refuses before the repository exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ repository: null }));

    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "PREFLIGHT_FALHOU" });
  });

  it("refuses before a briefing exists", async () => {
    mocks.projectFindFirst.mockResolvedValue(projectRow({ currentBriefVersion: null }));

    await expect(
      provisionContent({ actor: admin, siteProjectId: "project-1" }),
    ).rejects.toMatchObject({ code: "PREFLIGHT_FALHOU" });
  });

  it("commits the snapshot and the manifest, and records the sha", async () => {
    const result = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(result.alreadyDone).toBe(false);
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);

    const repo = [...sharedFakeWorld.repositories.values()][0];
    expect(repo.files.has(CONTENT_PATH)).toBe(true);
    expect(repo.files.has(MANIFEST_PATH)).toBe(true);
    expect(repo.commits).toHaveLength(1);
  });

  it("uses only the everyday App", async () => {
    sharedFakeWorld.credentialCalls.length = 0;
    await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(sharedFakeWorld.credentialCalls).toEqual(["reconciler"]);
    expect(sharedFakeWorld.credentialCalls).not.toContain("provisioner");
  });

  it("produces the same bytes on a second run, so nothing is recommitted", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // The provisioning row now remembers what was committed.
    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        provisioning: { contentSha256: first.contentSha256, commitSha: first.commitSha },
      }),
    );

    const second = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(true);
    expect(second.commitSha).toBe(first.commitSha);
    expect([...sharedFakeWorld.repositories.values()][0].commits).toHaveLength(1);
  });

  it("does not depend on the clock", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    // A fresh world and a fresh run of the same stored data must produce the
    // same fingerprint; a manifest carrying "now" would break this.
    sharedFakeWorld.reset();
    await seedRepository();
    const again = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(again.contentSha256).toBe(first.contentSha256);
    expect(again.commitSha).toBe(first.commitSha);
  });

  it("commits again when the briefing changes", async () => {
    const first = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    mocks.projectFindFirst.mockResolvedValue(
      projectRow({
        provisioning: { contentSha256: first.contentSha256, commitSha: first.commitSha },
        currentBriefVersion: {
          id: "brief-2",
          version: 3,
          contentJson: JSON.stringify({
            ...BRIEF_V2,
            objective: fact("Outro objetivo confirmado para o site."),
          }),
          factsHash: "b".repeat(64),
          createdAt: new Date("2026-08-25T16:00:00.000Z"),
        },
      }),
    );

    const second = await provisionContent({ actor: admin, siteProjectId: "project-1" });

    expect(second.alreadyDone).toBe(false);
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect([...sharedFakeWorld.repositories.values()][0].commits).toHaveLength(2);
  });

  it("audits the commit without carrying content", async () => {
    await provisionContent({ actor: admin, siteProjectId: "project-1" });

    const audited = mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(audited.action).toBe("provisioning.content.commit");
    expect(String(audited.metaJson)).toContain('"briefVersion":2');
    expect(String(audited.metaJson)).not.toContain("Oficina Demonstração");
  });
});
