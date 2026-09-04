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
  emptyContactDraft,
  emptyBriefDraft,
  isLeadSuggestion,
  applyLeadToDraft,
  leadContactDraft,
  mergeLeadContactDraft,
  pinServiceId,
  renameServiceDraft,
  setServiceId,
  slugifyServiceId,
  suggestedFact,
  typedFact,
  validatePublicContact,
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
    about: authoredFact(
      "O Estúdio Aurora atende estética facial e corporal em Fortaleza, com hora marcada e sala privativa.",
      AT,
    ),
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
      openingHours: [],
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

describe("o rascunho depois de escolher um lead", () => {
  const leadA = {
    name: "ZEN COMIDA JAPONESA",
    phoneE164: "+5585999990000",
    address: "Rua das Flores, 120",
    city: "Fortaleza",
    state: "CE",
    socialLinks: ["https://instagram.com/zen"],
  };

  it("oferece o nome do negócio como candidato, nunca como fato confirmado", () => {
    const seeded = applyLeadToDraft(initialBriefDraft(), leadA);

    // Re-caixado para quem vai ler, mas sem confirmação: clicar num cartão de
    // lead numa etapa anterior não é ler e aprovar este campo. Sem confirmar,
    // o briefing não é aceito.
    expect(seeded.businessName).toEqual({
      value: "Zen Comida Japonesa",
      source: "LEAD",
      confirmedAt: null,
    });
    expect(isLeadSuggestion(seeded.businessName)).toBe(true);
    expect(buildBriefV2(seeded).ok).toBe(false);
  });

  it("preenche o nome mesmo quando a caixa do lead já está certa", () => {
    // A condição antiga só preenchia quando o texto mudava — ou seja, deixava
    // vazio justamente o caso em que não havia nada a revisar.
    const seeded = applyLeadToDraft(initialBriefDraft(), { name: "GM Autos" });

    expect(seeded.businessName.value).toBe("GM Autos");
    expect(seeded.businessName.source).toBe("LEAD");
    expect(seeded.businessName.confirmedAt).toBeNull();
  });

  it("troca inteiramente o candidato quando o operador escolhe outro lead", () => {
    const first = applyLeadToDraft(initialBriefDraft(), leadA);
    const second = applyLeadToDraft(first, { name: "PADARIA DO JOÃO", phoneE164: null });

    expect(second.businessName.value).toBe("Padaria do João");
    expect(second.contact.phone.value).toBe("");
  });

  it("preserva o que o operador escreveu ou confirmou", () => {
    const typed = { ...initialBriefDraft(), businessName: authoredFact("Estúdio Aurora", AT) };
    const seeded = applyLeadToDraft(typed, leadA);

    expect(seeded.businessName).toEqual(typed.businessName);
  });

  it("aceita um lead sem nome sem inventar um", () => {
    const seeded = applyLeadToDraft(initialBriefDraft(), { phoneE164: "+5585999990000" });

    expect(seeded.businessName.value).toBe("");
    expect(seeded.contact.phone.value).toBe("+5585999990000");
  });
});

describe("apresentação para o cliente", () => {
  it("vira o fato que a seção Sobre publica", () => {
    const brief = builtBrief();
    expect(brief.about?.value).toContain("Estúdio Aurora atende estética");
    expect(brief.about?.source).toBe("OPERADOR");
  });

  it("cobra o campo em palavras, não com um rótulo seguido de dois-pontos", () => {
    // Um operador que lê "Apresentação para o cliente: confirme este campo"
    // ainda não sabe o que escrever ali. A mensagem diz o que fazer.
    const draft = { ...wizardDraft(), about: emptyBriefDraft().about };
    const built = buildBriefV2(draft);

    expect(built.ok).toBe(false);
    expect(built.issues).toContainEqual({
      field: "about",
      message: "Preencha a apresentação para o cliente.",
    });
  });

  it("é recusada quando carrega afirmação sem sustentação", () => {
    const draft = { ...wizardDraft(), about: authoredFact("O melhor estúdio da região.", AT) };
    const built = buildBriefV2(draft);

    expect(built.ok).toBe(false);
    expect(built.issues.map((issue) => issue.field)).toContain("about");
  });
});

describe("o contato sugerido pelo lead escolhido", () => {
  const lead = {
    name: "ESTÚDIO AURORA",
    phoneE164: "+5585999990000",
    address: "Rua das Flores, 120",
    neighborhood: "Aldeota",
    city: "Fortaleza",
    state: "CE",
    postalCode: "60000000",
    socialLinks: ["https://instagram.com/estudioaurora"],
  };

  it("oferece telefone, endereço e Instagram como candidatos do lead", () => {
    const draft = leadContactDraft(lead);

    expect(draft.phone).toEqual({ value: "+5585999990000", source: "LEAD", confirmedAt: null });
    // Celular: o mesmo número serve de WhatsApp.
    expect(draft.whatsapp).toEqual({ value: "+5585999990000", source: "LEAD", confirmedAt: null });
    expect(draft.address.street).toBe("Rua das Flores, 120");
    expect(draft.address.city).toBe("Fortaleza");
    expect(draft.address.state).toBe("CE");
    expect(draft.address.neighborhood).toBe("Aldeota");
    expect(draft.address.postalCode).toBe("60000000");
    expect(draft.address.source).toBe("LEAD");
    expect(draft.socialLinks).toHaveLength(1);
    expect(draft.socialLinks[0]).toMatchObject({
      platform: "INSTAGRAM",
      url: "https://instagram.com/estudioaurora",
      label: "@estudioaurora",
      source: "LEAD",
    });

    // Nada chega confirmado: o lead é fonte de candidato, não de fato.
    expect(draft.address.confirmedAt).toBeNull();
    expect(draft.socialLinks[0]!.confirmedAt).toBeNull();
    // O lead não tem horário nenhum, então nada é inventado aqui.
    expect(draft.openingHours.every((day) => !day.isOpen)).toBe(true);
    expect(draft.email).toEqual(emptyContactDraft().email);
  });

  it("não sugere WhatsApp para um número fixo", () => {
    const draft = leadContactDraft({ ...lead, phoneE164: "+558533334444" });

    expect(draft.phone.value).toBe("+558533334444");
    expect(draft.whatsapp).toEqual(emptyContactDraft().whatsapp);
  });

  it("devolve o rascunho vazio para um lead sem nada", () => {
    expect(leadContactDraft({ name: "Sem dados" })).toEqual(emptyContactDraft());
    expect(leadContactDraft(null)).toEqual(emptyContactDraft());
  });

  it("não sugere uma rede que o briefing não sabe nomear", () => {
    expect(leadContactDraft({ socialLinks: ["https://exemplo.com.br/perfil"] }).socialLinks).toEqual(
      [],
    );
  });

  it("substitui o candidato do lead anterior ao trocar de lead", () => {
    // O defeito: qualquer valor não vazio vencia, inclusive um candidato
    // `LEAD` não confirmado do lead anterior. Trocar de lead deixava telefone
    // e endereço do lead A no projeto do lead B — com o marcador "sugerido
    // pelo lead — confirme" apontando para o lead errado.
    const fromA = leadContactDraft(lead);
    const leadB = {
      name: "Outro Negócio",
      phoneE164: "+5511988887777",
      address: "Avenida Paulista, 1000",
      city: "São Paulo",
      state: "SP",
      socialLinks: ["https://instagram.com/outronegocio"],
    };

    const merged = mergeLeadContactDraft(fromA, leadContactDraft(leadB, (i) => `b-${i}`));

    expect(merged.phone.value).toBe("+5511988887777");
    expect(merged.whatsapp.value).toBe("+5511988887777");
    expect(merged.address.street).toBe("Avenida Paulista, 1000");
    expect(merged.address.city).toBe("São Paulo");
    expect(merged.socialLinks.map((link) => link.url)).toEqual([
      "https://instagram.com/outronegocio",
    ]);
  });

  it("esvazia o candidato obsoleto quando o novo lead não tem o dado", () => {
    // Substituir por nada também é substituir: o telefone do lead A não pode
    // ficar num projeto cujo lead B não tem telefone nenhum.
    const merged = mergeLeadContactDraft(
      leadContactDraft(lead),
      leadContactDraft({ name: "Sem dados" }),
    );

    expect(merged.phone).toEqual(emptyContactDraft().phone);
    expect(merged.whatsapp).toEqual(emptyContactDraft().whatsapp);
    expect(merged.address).toEqual(emptyContactDraft().address);
    expect(merged.socialLinks).toEqual([]);
  });

  it("não perde as sugestões por causa de uma linha de rede vazia", () => {
    // Uma linha aberta com "+ Adicionar rede" descartava todas as sugestões
    // de uma vez, porque a comparação era pelo tamanho da lista.
    const current = emptyContactDraft();
    current.socialLinks = [createSocialLinkDraft("vazia")];

    const merged = mergeLeadContactDraft(current, leadContactDraft(lead));

    expect(merged.socialLinks).toHaveLength(2);
    expect(merged.socialLinks.map((link) => link.url)).toContain(
      "https://instagram.com/estudioaurora",
    );
  });

  it("nunca sobrescreve o que o operador já digitou", () => {
    const current = emptyContactDraft();
    current.phone = typedFact("(85) 3333-4444");
    current.address = { ...current.address, street: "Avenida Beira Mar", city: "Fortaleza" };
    current.socialLinks = [
      { ...createSocialLinkDraft("s1"), url: "https://instagram.com/outro", source: "OPERADOR" },
    ];

    const merged = mergeLeadContactDraft(current, leadContactDraft(lead));

    expect(merged.phone).toEqual(current.phone);
    expect(merged.address.street).toBe("Avenida Beira Mar");
    // A rede que o operador digitou permanece, e continua sendo dele. A
    // sugestão do lead entra ao lado porque é outra URL — a fusão é por
    // endereço, não pelo tamanho da lista.
    expect(merged.socialLinks[0]).toEqual(current.socialLinks[0]);
    expect(merged.socialLinks.map((link) => link.url)).toEqual([
      "https://instagram.com/outro",
      "https://instagram.com/estudioaurora",
    ]);
    // O que estava vazio recebe a sugestão.
    expect(merged.whatsapp).toEqual({
      value: "+5585999990000",
      source: "LEAD",
      confirmedAt: null,
    });
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
      "about",
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

describe("expediente do contato público", () => {
  it("começa com sete dias fechados", () => {
    const openingHours = emptyContactDraft().openingHours;

    expect(openingHours).toHaveLength(7);
    expect(openingHours.every((day) => !day.isOpen)).toBe(true);
  });

  it("recusa abertura igual ou posterior ao fechamento", () => {
    const contact = emptyContactDraft();
    contact.openingHours[0] = {
      dayOfWeek: "SEGUNDA",
      isOpen: true,
      opens: "18:00",
      closes: "09:00",
    };

    expect(validatePublicContact(contact)).toContainEqual({
      field: "publicContact.openingHours.0",
      message: "Segunda-feira: o horário de abertura precisa ser anterior ao de fechamento.",
    });
  });

  it("recusa abertura igual ao fechamento", () => {
    const contact = emptyContactDraft();
    contact.openingHours[0] = {
      dayOfWeek: "SEGUNDA",
      isOpen: true,
      opens: "09:00",
      closes: "09:00",
    };

    expect(validatePublicContact(contact)).toContainEqual({
      field: "publicContact.openingHours.0",
      message: "Segunda-feira: o horário de abertura precisa ser anterior ao de fechamento.",
    });
  });

  it("recusa um horário sem zero à esquerda", () => {
    const contact = emptyContactDraft();
    contact.openingHours[0] = {
      dayOfWeek: "SEGUNDA",
      isOpen: true,
      opens: "9:00",
      closes: "18:00",
    };

    expect(validatePublicContact(contact)).toContainEqual({
      field: "publicContact.openingHours.0",
      message: "Segunda-feira: Use o formato HH:MM.",
    });
  });

  it("recusa um horário fora do intervalo de 24 horas", () => {
    const contact = emptyContactDraft();
    contact.openingHours[0] = {
      dayOfWeek: "SEGUNDA",
      isOpen: true,
      opens: "25:00",
      closes: "18:00",
    };

    expect(validatePublicContact(contact)).toContainEqual({
      field: "publicContact.openingHours.0",
      message: "Segunda-feira: Use o formato HH:MM.",
    });
  });

  it("aceita um horário válido no formato HH:MM", () => {
    const contact = emptyContactDraft();
    contact.openingHours[0] = {
      dayOfWeek: "SEGUNDA",
      isOpen: true,
      opens: "09:00",
      closes: "18:00",
    };

    expect(validatePublicContact(contact)).toEqual([]);
  });

  it("converte apenas os dois dias abertos para uma única confirmação", () => {
    const draft = wizardDraft();
    draft.contact.openingHours = [
      { dayOfWeek: "SEGUNDA", isOpen: true, opens: "09:00", closes: "18:00" },
      { dayOfWeek: "TERCA", isOpen: false, opens: "09:00", closes: "18:00" },
      { dayOfWeek: "QUARTA", isOpen: true, opens: "10:00", closes: "16:00" },
    ];

    const built = buildBriefV2(draft);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.publicContact.openingHours).toEqual({
      value: [
        { dayOfWeek: "SEGUNDA", opens: "09:00", closes: "18:00" },
        { dayOfWeek: "QUARTA", opens: "10:00", closes: "16:00" },
      ],
      source: "OPERADOR",
      confirmedAt: expect.any(String),
    });
  });

  it("não cria fato quando nenhum dia está aberto", () => {
    const draft = wizardDraft();
    draft.contact.openingHours = [
      { dayOfWeek: "SEGUNDA", isOpen: false, opens: "09:00", closes: "18:00" },
      { dayOfWeek: "TERCA", isOpen: false, opens: "09:00", closes: "18:00" },
    ];

    const built = buildBriefV2(draft);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.publicContact.openingHours).toBeNull();
  });
});
