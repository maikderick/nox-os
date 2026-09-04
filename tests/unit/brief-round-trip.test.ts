import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authoredFact,
  briefDraftLosses,
  briefToDraft,
  buildBriefV2,
  editAddressDraft,
  editOpeningHours,
  type BriefDraft,
} from "@/lib/site-factory/brief-draft";
import {
  siteBriefSchema,
  type SiteBrief,
  type SiteBriefV2,
} from "@/lib/site-factory/brief-schema";

/**
 * The editor loads a stored briefing and saves it again.
 *
 * The one property that matters is that the trip changes nothing: an operator
 * who opens the briefing of a live project to add a service must not discover
 * afterwards that the phone lost its confirmation date, the schedule was
 * re-attributed to them, or the map pin disappeared. Every assertion here is
 * about a fact nobody edited.
 */

const AT = "2026-08-25T12:00:00.000Z";

/** Far from `AT`, so anything re-stamped on the way through shows up. */
const NOW = "2027-03-14T09:30:00.000Z";

function fact(value: string, source: "LEAD" | "OPERADOR" | "CLIENTE" | "IMPORTACAO" = "OPERADOR") {
  return { value, source, confirmedAt: AT } as const;
}

/**
 * A briefing that uses everything the wizard can write: a presentation text, a
 * priced service, a weekly schedule confirmed by the client, coordinates, and
 * a differentiator with a comma in it.
 */
function storedBrief(): SiteBriefV2 {
  return siteBriefSchema.parse({
    schemaVersion: 2,
    businessName: fact("Estúdio Aurora", "LEAD"),
    sector: fact("Estética"),
    city: fact("Fortaleza", "LEAD"),
    about: fact(
      "O Estúdio Aurora atende estética facial e corporal em Fortaleza, com hora marcada e sala privativa.",
    ),
    objective: fact("Criar um site completo para apresentar o negócio e facilitar novos contatos."),
    audience: fact("Pessoas que procuram os serviços do negócio na região."),
    positioning: fact("Apresentar informações confirmadas com clareza e credibilidade."),
    differentiators: [fact("Atendimento individual em sala privativa"), fact("Equipe própria")],
    desiredSections: ["Início", "Sobre", "Serviços", "Contato"],
    visualDirection: fact("Visual contemporâneo, legível e adequado ao setor."),
    notes: fact("Cliente prefere ser avisado antes de qualquer publicação."),
    services: [
      {
        id: "limpeza-de-pele",
        name: fact("Limpeza de pele"),
        summary: fact("Procedimento facial realizado na própria clínica."),
        body: [
          fact("A sessão é conduzida por profissional da clínica."),
          fact("O procedimento é agendado com antecedência."),
        ],
        price: fact("R$ 180"),
        relatedIds: ["massagem-relaxante"],
        featured: false,
      },
      {
        id: "massagem-relaxante",
        name: fact("Massagem relaxante"),
        summary: fact("Sessão de massagem conduzida no estúdio."),
        body: [fact("A sessão acontece em sala privativa.")],
        price: null,
        relatedIds: [],
        featured: true,
      },
    ],
    publicContact: {
      phone: { value: "+558533334444", source: "OPERADOR", confirmedAt: AT },
      whatsapp: { value: "+5585999990000", source: "LEAD", confirmedAt: AT },
      email: { value: "contato@estudioaurora.com.br", source: "OPERADOR", confirmedAt: AT },
      address: {
        value: {
          street: "Rua das Flores",
          number: "120",
          complement: null,
          neighborhood: "Aldeota",
          city: "Fortaleza",
          state: "CE",
          postalCode: "60000000",
          country: "Brasil",
        },
        source: "LEAD",
        confirmedAt: AT,
      },
      coordinates: {
        value: { latitude: -3.7319, longitude: -38.5267 },
        source: "IMPORTACAO",
        confirmedAt: AT,
      },
      openingHours: {
        value: [
          { dayOfWeek: "SEGUNDA", opens: "09:00", closes: "18:00" },
          { dayOfWeek: "SABADO", opens: "09:00", closes: "13:00" },
        ],
        source: "CLIENTE",
        confirmedAt: AT,
      },
      socialLinks: [
        {
          value: {
            platform: "INSTAGRAM",
            url: "https://instagram.com/estudioaurora",
            label: "@estudioaurora",
          },
          source: "LEAD",
          confirmedAt: AT,
        },
      ],
    },
    metaDescription: fact("Estúdio de estética em Fortaleza com atendimento individual."),
  }) as SiteBriefV2;
}

function rebuild(draft: BriefDraft): SiteBriefV2 {
  const built = buildBriefV2(draft);
  if (!built.ok) throw new Error(built.issues.map((issue) => issue.message).join(" | "));
  return built.brief;
}

afterEach(() => {
  vi.useRealTimers();
});

/** Freezes the clock away from `AT`, so a re-stamp cannot pass unnoticed. */
function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
}

describe("ida e volta do briefing gravado", () => {
  it("devolve exatamente o mesmo briefing quando nada é editado", () => {
    freezeClock();
    const brief = storedBrief();

    expect(rebuild(briefToDraft(brief))).toEqual(brief);
  });

  it("não re-data nenhum fato confirmado", () => {
    freezeClock();
    const draft = briefToDraft(storedBrief());

    const stamps = [
      draft.businessName,
      draft.about,
      draft.positioning,
      draft.differentiators,
      draft.contact.phone,
      draft.contact.whatsapp,
      draft.contact.email,
      draft.contact.address,
      draft.contact.socialLinks[0],
    ].map((entry) => entry.confirmedAt);

    expect(stamps).toEqual(Array(stamps.length).fill(AT));
    expect(draft.services.map((service) => service.confirmedAt)).toEqual([AT, AT]);
    expect(draft.contact.openingHoursFact).toEqual({ source: "CLIENTE", confirmedAt: AT });
    // And the origins survive: what the lead answered is still the lead's.
    expect(draft.businessName.source).toBe("LEAD");
    expect(draft.contact.whatsapp.source).toBe("LEAD");
    expect(draft.contact.address.source).toBe("LEAD");
  });

  it("hidrata serviços, endereço, redes e horário na forma que o formulário edita", () => {
    const draft = briefToDraft(storedBrief());

    expect(draft.services[0]).toMatchObject({
      id: "limpeza-de-pele",
      idPinned: true,
      name: "Limpeza de pele",
      price: "R$ 180",
      relatedIds: ["massagem-relaxante"],
      featured: false,
    });
    // One paragraph per line, which is what the content field reads back.
    expect(draft.services[0].body.split("\n")).toHaveLength(2);
    expect(draft.services[1].price).toBe("");

    expect(draft.contact.address).toMatchObject({
      street: "Rua das Flores",
      number: "120",
      // A null in the payload is an empty field on screen, not the word "null".
      complement: "",
      city: "Fortaleza",
      country: "Brasil",
    });

    expect(draft.contact.socialLinks[0]).toMatchObject({
      platform: "INSTAGRAM",
      url: "https://instagram.com/estudioaurora",
      label: "@estudioaurora",
    });

    // Seven rows, two of them open, in the week's own order.
    expect(draft.contact.openingHours).toHaveLength(7);
    expect(
      draft.contact.openingHours.filter((day) => day.isOpen).map((day) => day.dayOfWeek),
    ).toEqual(["SEGUNDA", "SABADO"]);
    expect(draft.contact.openingHours[0]).toMatchObject({ opens: "09:00", closes: "18:00" });

    // Um diferencial por linha, que é como o campo os mostra.
    expect(draft.differentiators.value.split("\n")).toEqual([
      "Atendimento individual em sala privativa",
      "Equipe própria",
    ]);
  });

  it("editar uma frase muda só aquela frase", () => {
    freezeClock();
    const brief = storedBrief();
    const draft = briefToDraft(brief);

    const edited = rebuild({
      ...draft,
      about: authoredFact("O Estúdio Aurora atende com hora marcada, em sala privativa."),
    });

    expect(edited.about).toEqual({
      value: "O Estúdio Aurora atende com hora marcada, em sala privativa.",
      source: "OPERADOR",
      // Escrever é confirmar: este é o único carimbo novo do briefing.
      confirmedAt: NOW,
    });
    expect({ ...edited, about: brief.about }).toEqual(brief);
  });

  it("editar o horário re-carimba a semana em nome de quem editou", () => {
    freezeClock();
    const draft = briefToDraft(storedBrief());

    const rebuilt = rebuild({
      ...draft,
      contact: editOpeningHours(draft.contact, 0, { closes: "19:00" }),
    });

    expect(rebuilt.publicContact.openingHours).toEqual({
      value: [
        { dayOfWeek: "SEGUNDA", opens: "09:00", closes: "19:00" },
        { dayOfWeek: "SABADO", opens: "09:00", closes: "13:00" },
      ],
      // A confirmação do cliente era para outro horário; ela não sobrevive.
      source: "OPERADOR",
      confirmedAt: NOW,
    });
  });

  it("editar o endereço descarta a coordenada do endereço antigo", () => {
    freezeClock();
    const draft = briefToDraft(storedBrief());

    const contact = editAddressDraft(draft.contact, { street: "Avenida Central" });
    expect(contact.coordinates).toBeNull();
    expect(contact.address.confirmedAt).toBeNull();
    expect(contact.address.source).toBe("OPERADOR");

    // Sem confirmação o endereço não é enviado — e a coordenada não fica para
    // trás apontando uma rua que ninguém mais informou.
    const rebuilt = rebuild({ ...draft, contact });
    expect(rebuilt.publicContact.address).toBeNull();
    expect(rebuilt.publicContact.coordinates).toBeNull();
  });

  it("mantém a coordenada de um endereço que ninguém tocou", () => {
    freezeClock();
    const brief = storedBrief();

    expect(rebuild(briefToDraft(brief)).publicContact.coordinates).toEqual(
      brief.publicContact.coordinates,
    );
  });
});

describe("briefings que o editor não escreveu", () => {
  it("carrega um briefing v1: nomes de serviço preservados, campos novos vazios", () => {
    const legacy = siteBriefSchema.parse({
      schemaVersion: 1,
      businessName: fact("Padaria Aurora"),
      sector: fact("Padaria"),
      city: null,
      objective: fact("Apresentar informações confirmadas sobre o negócio."),
      audience: fact("Pessoas que procuram uma padaria na região."),
      positioning: fact("Comunicação clara sobre o negócio."),
      services: [fact("Pães artesanais"), fact("Bolos sob encomenda")],
      differentiators: [],
      desiredSections: ["Início", "Sobre", "Contato"],
      visualDirection: fact("Layout sóbrio e legível."),
      notes: null,
    }) as SiteBrief;

    const draft = briefToDraft(legacy);

    // O que a v1 guardava continua ali, com a data em que foi confirmado.
    expect(draft.businessName.value).toBe("Padaria Aurora");
    expect(draft.services.map((service) => service.name)).toEqual([
      "Pães artesanais",
      "Bolos sob encomenda",
    ]);
    expect(draft.services[0]).toMatchObject({ id: "paes-artesanais", confirmedAt: AT });
    // O que ela não guardava chega vazio, não inventado.
    expect(draft.about.value).toBe("");
    expect(draft.about.confirmedAt).toBeNull();
    expect(draft.contact.phone.value).toBe("");
    expect(draft.services[0].summary).toBe("");

    // E o rascunho recusa o envio até que alguém descreva os serviços e
    // escreva a apresentação: é essa recusa que faz a migração acontecer.
    const built = buildBriefV2(draft);
    expect(built.ok).toBe(false);
    const messages = built.issues.map((issue) => issue.message).join(" | ");
    expect(messages).toContain("Preencha a apresentação para o cliente.");
    expect(messages).toContain("Serviço 1: informe o resumo.");
  });

  it("trata `about` ausente como campo em branco, sem inventar texto", () => {
    const brief = storedBrief();
    const withoutAbout = { ...brief };
    delete (withoutAbout as { about?: unknown }).about;

    const draft = briefToDraft(siteBriefSchema.parse(withoutAbout) as SiteBrief);
    expect(draft.about).toEqual({ value: "", source: "OPERADOR", confirmedAt: null });
  });

  it("avisa quando o briefing guarda mais do que o formulário sabe mostrar", () => {
    const brief = storedBrief();
    const split = siteBriefSchema.parse({
      ...brief,
      publicContact: {
        ...brief.publicContact,
        openingHours: {
          ...brief.publicContact.openingHours,
          value: [
            { dayOfWeek: "SEGUNDA", opens: "09:00", closes: "12:00" },
            { dayOfWeek: "SEGUNDA", opens: "14:00", closes: "18:00" },
          ],
        },
      },
    }) as SiteBrief;

    expect(briefDraftLosses(split)).toEqual([
      "Segunda-feira: o briefing guarda mais de um intervalo neste dia. O editor mostra apenas o primeiro, e salvar descarta os demais.",
    ]);
    // O primeiro intervalo é o que fica visível.
    expect(briefToDraft(split).contact.openingHours[0]).toMatchObject({
      isOpen: true,
      opens: "09:00",
      closes: "12:00",
    });
    // Um briefing que o formulário representa inteiro não avisa nada.
    expect(briefDraftLosses(brief)).toEqual([]);
  });

  it("avisa que um diferencial com vírgula será dividido ao salvar", () => {
    // O campo de diferenciais separa por vírgula, então um item que já tem uma
    // volta como dois. Isso não é evitável sem mudar o contrato do campo — o
    // que é evitável é o operador descobrir depois de salvar.
    const brief = storedBrief();
    const withComma = siteBriefSchema.parse({
      ...brief,
      differentiators: [
        { value: "Atendimento individual, em sala privativa", source: "OPERADOR", confirmedAt: AT },
      ],
    }) as SiteBrief;

    expect(briefDraftLosses(withComma)).toEqual([
      "O diferencial “Atendimento individual, em sala privativa” tem vírgula, e o campo separa os diferenciais por vírgula. Salvar vai dividi-lo em dois: reescreva-o sem vírgula para mantê-lo inteiro.",
    ]);
    expect(rebuild(briefToDraft(withComma)).differentiators.map((entry) => entry.value)).toEqual([
      "Atendimento individual",
      "em sala privativa",
    ]);
  });
});
