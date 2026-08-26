import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  listProjects: vi.fn(),
  convert: vi.fn(),
  createProject: vi.fn(),
  createBrief: vi.fn(),
  createProjectWithBrief: vi.fn(),
}));

vi.mock("@/lib/authz/dal", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/site-factory/project-service", () => ({
  listSiteProjects: mocks.listProjects,
  createSiteProject: mocks.createProject,
}));
vi.mock("@/lib/site-factory/client-service", () => ({ convertBusinessToClient: mocks.convert }));
vi.mock("@/lib/site-factory/brief-service", () => ({ createSiteBriefVersion: mocks.createBrief }));
// The route delegates the whole submission to one unit of work; the transaction
// itself is covered against a real database in site-factory-db.test.ts.
vi.mock("@/lib/site-factory/project-intake", () => ({
  createProjectWithBrief: mocks.createProjectWithBrief,
}));

import { POST } from "../../src/app/api/projects/route";
import {
  authoredFact,
  buildBriefV2,
  editSocialLinkDraft,
  initialBriefDraft,
  type SocialLinkDraft,
  createServiceDraft,
  createSocialLinkDraft,
  emptyBriefDraft,
  pinServiceId,
  renameServiceDraft,
  setServiceId,
  slugifyServiceId,
  suggestedFact,
  typedFact,
  validateServices,
  type BriefDraft,
  type ServiceDraft,
} from "../../src/lib/site-factory/brief-draft";
import {
  briefCapabilities,
  siteBriefSchema,
  type SiteBriefV2,
} from "../../src/lib/site-factory/brief-schema";

const AT = "2026-08-25T12:00:00.000Z";

function service(overrides: Partial<ServiceDraft> = {}): ServiceDraft {
  return {
    ...createServiceDraft("k1", AT),
    id: "limpeza-de-pele",
    idPinned: true,
    name: "Limpeza de pele",
    summary: "Procedimento facial realizado na própria clínica.",
    body: "A sessão é conduzida por profissional da clínica.\nO procedimento é agendado com antecedência.",
    ...overrides,
  };
}

/**
 * The draft as it stands after an operator filled every step of the wizard:
 * some fields written by hand, some accepted from the lead, and one filled but
 * deliberately left unconfirmed.
 */
function wizardDraft(): BriefDraft {
  const empty = emptyBriefDraft();
  return {
    ...empty,
    businessName: { value: "Estúdio Aurora", source: "LEAD", confirmedAt: AT },
    sector: authoredFact("Estética", AT),
    city: { value: "Fortaleza", source: "LEAD", confirmedAt: AT },
    objective: authoredFact(
      "Criar um site completo para apresentar o negócio e facilitar novos contatos.",
      AT,
    ),
    audience: authoredFact("Pessoas que procuram os serviços do negócio na região.", AT),
    positioning: authoredFact("Apresentar informações confirmadas com clareza e credibilidade.", AT),
    visualDirection: authoredFact("Visual contemporâneo, legível e adequado ao setor.", AT),
    differentiators: authoredFact("Atendimento individual, Sala privativa", AT),
    desiredSections: "Início, Sobre, Serviços, Contato",
    metaDescription: authoredFact("Estúdio de estética em Fortaleza com atendimento individual.", AT),
    notes: empty.notes,
    services: [
      service(),
      service({
        key: "k2",
        id: "massagem-relaxante",
        name: "Massagem relaxante",
        summary: "Sessão de massagem conduzida no estúdio.",
        body: "A sessão acontece em sala privativa.",
        featured: true,
        relatedIds: ["limpeza-de-pele"],
      }),
    ],
    contact: {
      phone: { value: "(85) 3333-4444", source: "OPERADOR", confirmedAt: AT },
      whatsapp: { value: "(85) 99999-0000", source: "LEAD", confirmedAt: AT },
      email: { value: "contato@estudioaurora.com.br", source: "OPERADOR", confirmedAt: AT },
      address: {
        street: "Rua das Flores",
        number: "120",
        complement: "",
        neighborhood: "Aldeota",
        city: "Fortaleza",
        state: "CE",
        postalCode: "60000000",
        country: "Brasil",
        source: "LEAD",
        confirmedAt: AT,
      },
      socialLinks: [
        {
          ...createSocialLinkDraft("s1"),
          platform: "INSTAGRAM",
          url: "https://instagram.com/estudioaurora",
          source: "LEAD",
          confirmedAt: AT,
        },
      ],
    },
  };
}

function builtBrief(draft: BriefDraft = wizardDraft()): SiteBriefV2 {
  const built = buildBriefV2(draft);
  if (!built.ok) throw new Error(built.issues.map((issue) => issue.message).join(" | "));
  return built.brief;
}

const actor = { userId: "user-1", organizationId: "org-1", role: "OPERADOR" };

describe("payload do assistente de novo projeto", () => {
  it("é aceito pelo schema como briefing v2", () => {
    const parsed = siteBriefSchema.parse(builtBrief());
    expect(parsed.schemaVersion).toBe(2);
  });

  it("normaliza telefone e WhatsApp para E.164 antes de enviar", () => {
    const brief = builtBrief();
    expect(brief.publicContact.phone?.value).toBe("+558533334444");
    expect(brief.publicContact.whatsapp?.value).toBe("+5585999990000");
    expect(brief.publicContact.whatsapp?.source).toBe("LEAD");
  });

  it("recusa um telefone confirmado que não vira E.164", () => {
    const draft = wizardDraft();
    draft.contact.phone = { value: "12345", source: "OPERADOR", confirmedAt: AT };
    const built = buildBriefV2(draft);
    expect(built.ok).toBe(false);
    expect(built.issues.map((issue) => issue.message).join(" ")).toMatch(/número inválido/i);
  });

  it("declara páginas de serviço e contato confirmado, sem lacunas", () => {
    const capabilities = briefCapabilities(siteBriefSchema.parse(builtBrief()));
    expect(capabilities).toEqual({
      schemaVersion: 2,
      canGenerateServicePages: true,
      hasConfirmedPublicContact: true,
      gaps: [],
    });
  });
});

describe("um campo preenchido e não confirmado não entra no payload", () => {
  it("descarta texto digitado sem confirmação e sugestões do lead não aceitas", () => {
    const draft = wizardDraft();
    // Typed into the wizard and left there: no "confirmado", no payload.
    draft.notes = typedFact("Observação ainda em discussão com o cliente.");
    draft.metaDescription = typedFact("Descrição escrita mas não confirmada.");
    draft.contact.email = typedFact("contato@estudioaurora.com.br");
    draft.contact.address = { ...draft.contact.address, confirmedAt: null };
    // Offered by the lead card and never accepted.
    draft.contact.phone = suggestedFact("(85) 3333-4444");
    draft.contact.socialLinks = [
      { ...createSocialLinkDraft("s9"), url: "https://instagram.com/naoconfirmado", source: "LEAD" },
    ];

    const brief = builtBrief(draft);

    expect(brief.notes).toBeNull();
    expect(brief.metaDescription).toBeNull();
    expect(brief.publicContact.email).toBeNull();
    expect(brief.publicContact.phone).toBeNull();
    expect(brief.publicContact.address).toBeNull();
    expect(brief.publicContact.socialLinks).toEqual([]);
    expect(JSON.stringify(brief)).not.toContain("naoconfirmado");
    expect(JSON.stringify(brief)).not.toContain("ainda em discussão");
  });

  it("não bloqueia por afirmação escrita num campo que não será enviado", () => {
    const risky = "A melhor da região com 50% de desconto.";
    const unconfirmed = { ...wizardDraft(), notes: typedFact(risky) };
    expect(buildBriefV2(unconfirmed).ok).toBe(true);

    const confirmed = { ...wizardDraft(), notes: authoredFact(risky, AT) };
    const built = buildBriefV2(confirmed);
    expect(built.ok).toBe(false);
    expect(built.issues.map((issue) => issue.message).join(" ")).toMatch(/não sustentada/i);
  });

  it("exige confirmação nos campos obrigatórios", () => {
    const draft = wizardDraft();
    draft.businessName = typedFact("Estúdio Aurora");
    const built = buildBriefV2(draft);
    expect(built.ok).toBe(false);
    expect(built.issues.map((issue) => issue.field)).toContain("businessName");
  });
});

describe("serviços do assistente", () => {
  it("recusa um serviço sem resumo ou sem conteúdo", () => {
    expect(validateServices([service({ summary: "" })]).map((issue) => issue.field)).toContain(
      "services.0.summary",
    );
    expect(validateServices([service({ body: "  " })]).map((issue) => issue.field)).toContain(
      "services.0.body",
    );

    const withoutSummary = builtBrief() as unknown as Record<string, unknown>;
    const services = [...(withoutSummary.services as Record<string, unknown>[])];
    services[0] = { ...services[0] };
    delete services[0].summary;
    expect(siteBriefSchema.safeParse({ ...withoutSummary, services }).success).toBe(false);

    const withoutBody = builtBrief() as unknown as Record<string, unknown>;
    const emptied = [...(withoutBody.services as Record<string, unknown>[])];
    emptied[0] = { ...emptied[0], body: [] };
    expect(siteBriefSchema.safeParse({ ...withoutBody, services: emptied }).success).toBe(false);
  });

  it("recusa dois serviços com o mesmo identificador", () => {
    const duplicated = [service(), service({ key: "k2", name: "Outro serviço" })];
    expect(duplicated[0].id).toBe(duplicated[1].id);
    expect(validateServices(duplicated).map((issue) => issue.field)).toContain("services.1.id");

    const brief = builtBrief() as unknown as Record<string, unknown>;
    const services = brief.services as Record<string, unknown>[];
    const collided = [services[0], { ...services[1], id: services[0].id }];
    const result = siteBriefSchema.safeParse({ ...brief, services: collided });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(
        /Identificador repetido/,
      );
    }
  });

  it("recusa um relacionado que não existe", () => {
    const orphan = [service({ relatedIds: ["nao-existe"] })];
    expect(validateServices(orphan).map((issue) => issue.field)).toContain("services.0.relatedIds");
  });

  it("deriva o identificador do nome", () => {
    expect(slugifyServiceId("Limpeza de Pele")).toBe("limpeza-de-pele");
    expect(slugifyServiceId("Massagem  relaxante!")).toBe("massagem-relaxante");
    expect(slugifyServiceId("Manutenção Elétrica")).toBe("manutencao-eletrica");
    expect(slugifyServiceId("   ")).toBe("");
  });

  it("mantém o identificador quando o serviço é renomeado", () => {
    let draft = createServiceDraft("k1", AT);
    draft = renameServiceDraft(draft, "Limpeza de pele", AT);
    expect(draft.id).toBe("limpeza-de-pele");

    // Leaving the name field freezes the id.
    draft = pinServiceId(draft);
    draft = renameServiceDraft(draft, "Limpeza de pele profunda", AT);
    expect(draft.name).toBe("Limpeza de pele profunda");
    expect(draft.id).toBe("limpeza-de-pele");

    draft = renameServiceDraft(draft, "Outro nome completamente diferente", AT);
    expect(draft.id).toBe("limpeza-de-pele");
  });

  it("deixa o operador editar o identificador e o congela", () => {
    let draft = renameServiceDraft(createServiceDraft("k1", AT), "Limpeza de pele", AT);
    draft = setServiceId(draft, "Limpeza Facial");
    expect(draft.id).toBe("limpeza-facial");
    expect(draft.idPinned).toBe(true);
    expect(renameServiceDraft(draft, "Qualquer outro nome", AT).id).toBe("limpeza-facial");
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.convert.mockResolvedValue({ id: "client-1" });
    mocks.createProject.mockResolvedValue({ id: "project-1", status: "RASCUNHO" });
    mocks.createBrief.mockResolvedValue({ id: "brief-1", version: 1 });
    mocks.createProjectWithBrief.mockResolvedValue({
      client: { id: "client-1" },
      project: { id: "project-1", status: "BRIEFING_PRONTO", currentBriefVersionId: "brief-1" },
      briefVersion: { id: "brief-1", version: 1 },
    });
  });

  async function post(brief: unknown) {
    return POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: "lead-1",
          name: "Site Estúdio Aurora",
          sector: "Estética",
          brief,
        }),
      }),
    );
  }

  it("responde com as capacidades do briefing recém-criado", async () => {
    const response = await post(builtBrief());
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { capabilities: unknown };
    expect(payload.capabilities).toEqual({
      schemaVersion: 2,
      canGenerateServicePages: true,
      hasConfirmedPublicContact: true,
      gaps: [],
    });
    expect(mocks.createProjectWithBrief).toHaveBeenCalledOnce();
  });

  it("relata as lacunas quando o briefing não tem serviços nem contato", async () => {
    const brief = { ...builtBrief(), services: [], publicContact: undefined };
    delete (brief as Record<string, unknown>).publicContact;
    const response = await post(brief);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      capabilities: { canGenerateServicePages: boolean; hasConfirmedPublicContact: boolean; gaps: string[] };
    };
    expect(payload.capabilities.canGenerateServicePages).toBe(false);
    expect(payload.capabilities.hasConfirmedPublicContact).toBe(false);
    expect(payload.capabilities.gaps).toHaveLength(2);
  });

  it("recusa o payload do assistente com identificadores repetidos", async () => {
    const brief = builtBrief() as unknown as Record<string, unknown>;
    const services = brief.services as Record<string, unknown>[];
    const response = await post({
      ...brief,
      services: [services[0], { ...services[1], id: services[0].id, relatedIds: [] }],
    });
    expect(response.status).toBe(400);
    expect(mocks.convert).not.toHaveBeenCalled();
  });
});

describe("o rascunho inicial do assistente", () => {
  it("não confirma nenhum texto que o operador não escreveu", () => {
    const draft = initialBriefDraft();

    // Boilerplate arriving pre-confirmed would reach the site as the client's
    // own positioning, confirmed by someone who never read it.
    for (const field of [
      "businessName",
      "sector",
      "city",
      "objective",
      "audience",
      "positioning",
      "visualDirection",
      "notes",
      "metaDescription",
      "differentiators",
    ] as const) {
      expect(draft[field].value, field).toBe("");
      expect(draft[field].confirmedAt, field).toBeNull();
    }
  });

  it("mantém apenas a configuração de quais páginas construir", () => {
    // Which sections to build is a decision about the site, not a claim about
    // the client, so it may start with a sensible default.
    expect(initialBriefDraft().desiredSections).toBe("Início, Sobre, Serviços, Contato");
    expect(initialBriefDraft().services).toEqual([]);
  });

  it("não produz um briefing enquanto o operador não escrever nada", () => {
    const result = buildBriefV2(initialBriefDraft());
    expect(result.ok).toBe(false);
  });
});

describe("editar uma rede social exige nova confirmação", () => {
  const confirmed = (): SocialLinkDraft => ({
    key: "r1",
    platform: "INSTAGRAM",
    url: "https://instagram.com/exemplo-demonstracao",
    label: "Instagram",
    source: "LEAD",
    confirmedAt: "2026-08-25T12:00:00.000-03:00",
  });

  for (const [field, value] of [
    ["platform", "FACEBOOK"],
    ["url", "https://facebook.com/outro-perfil"],
    ["label", "Nosso perfil"],
  ] as const) {
    it(`limpa a confirmação e devolve a origem ao operador ao editar ${field}`, () => {
      const edited = editSocialLinkDraft(confirmed(), { [field]: value });

      expect(edited[field]).toBe(value);
      // What was checked is no longer what would be published.
      expect(edited.confirmedAt).toBeNull();
      // And it is no longer the lead's value, whoever it came from originally.
      expect(edited.source).toBe("OPERADOR");
    });
  }

  it("mantém a confirmação quando o valor não muda", () => {
    const link = confirmed();
    const edited = editSocialLinkDraft(link, { platform: link.platform, label: link.label });

    expect(edited.confirmedAt).toBe(link.confirmedAt);
    expect(edited.source).toBe("LEAD");
  });

  it("permite confirmar sem se autolimpar", () => {
    const pending = { ...confirmed(), source: "OPERADOR" as const, confirmedAt: null };
    const edited = editSocialLinkDraft(pending, { confirmedAt: "2026-08-25T15:00:00.000-03:00" });

    expect(edited.confirmedAt).toBe("2026-08-25T15:00:00.000-03:00");
  });

  it("uma rede editada e não reconfirmada não entra no payload", () => {
    const draft = wizardDraft();
    draft.contact.socialLinks = [editSocialLinkDraft(confirmed(), { label: "Outro rótulo" })];

    const built = buildBriefV2(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.publicContact.socialLinks).toEqual([]);
  });
});
