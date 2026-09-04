import {
  acceptedFact,
  authoredFact,
  createServiceDraft,
  createSocialLinkDraft,
  initialBriefDraft,
  leadContactDraft,
  type BriefDraft,
} from "@/lib/site-factory/brief-draft";

/**
 * The draft the wizard holds after a full pass: a lead picked, its candidates
 * confirmed one by one, two services written, a week filled in.
 *
 * Written the way the form writes it — `acceptedFact` where the operator
 * clicked "Usar", `authoredFact` where they typed — so the payload it produces
 * is the payload the create flow actually sends.
 */
export const CREATE_AT = "2026-09-04T11:30:00.000Z";

export function createDraft(): BriefDraft {
  const contact = leadContactDraft({
    name: "Estúdio Aurora",
    phoneE164: "+5585999990000",
    address: "Rua das Flores",
    neighborhood: "Aldeota",
    city: "Fortaleza",
    state: "CE",
    postalCode: "60000000",
    socialLinks: ["https://instagram.com/estudioaurora"],
  });

  return {
    ...initialBriefDraft(),
    businessName: acceptedFact("Estúdio Aurora", CREATE_AT),
    sector: authoredFact("Estética", CREATE_AT),
    city: acceptedFact("Fortaleza", CREATE_AT),
    about: authoredFact(
      "O Estúdio Aurora atende estética facial e corporal em Fortaleza, em sala privativa.",
      CREATE_AT,
    ),
    objective: authoredFact(
      "Criar um site completo para apresentar o negócio e facilitar novos contatos.",
      CREATE_AT,
    ),
    audience: authoredFact("Pessoas que procuram os serviços do negócio na região.", CREATE_AT),
    positioning: authoredFact(
      "Apresentar informações confirmadas com clareza e credibilidade.",
      CREATE_AT,
    ),
    visualDirection: authoredFact("Visual contemporâneo, legível e adequado ao setor.", CREATE_AT),
    differentiators: authoredFact("Equipe própria, Sala privativa", CREATE_AT),
    metaDescription: authoredFact(
      "Estúdio de estética em Fortaleza com atendimento individual.",
      CREATE_AT,
    ),
    notes: authoredFact("Cliente prefere ser avisado antes de qualquer publicação.", CREATE_AT),
    services: [
      {
        ...createServiceDraft("row-1", CREATE_AT),
        id: "limpeza-de-pele",
        idPinned: true,
        name: "Limpeza de pele",
        summary: "Procedimento facial realizado na própria clínica.",
        body: "A sessão é conduzida por profissional da clínica.\nO procedimento é agendado com antecedência.",
        price: "R$ 180",
      },
      {
        ...createServiceDraft("row-2", CREATE_AT),
        id: "massagem-relaxante",
        idPinned: true,
        name: "Massagem relaxante",
        summary: "Sessão de massagem conduzida no estúdio.",
        body: "A sessão acontece em sala privativa.",
        featured: true,
        relatedIds: ["limpeza-de-pele"],
      },
    ],
    contact: {
      ...contact,
      // Confirmados um a um, como o formulário exige.
      phone: { ...contact.phone, confirmedAt: CREATE_AT },
      whatsapp: { ...contact.whatsapp, confirmedAt: CREATE_AT },
      email: authoredFact("contato@estudioaurora.com.br", CREATE_AT),
      address: { ...contact.address, number: "120", confirmedAt: CREATE_AT },
      openingHours: contact.openingHours.map((day) =>
        day.dayOfWeek === "SEGUNDA" || day.dayOfWeek === "SABADO"
          ? { ...day, isOpen: true, opens: "09:00", closes: day.dayOfWeek === "SABADO" ? "13:00" : "18:00" }
          : day,
      ),
      socialLinks: [
        { ...createSocialLinkDraft("row-3"), ...contact.socialLinks[0], confirmedAt: CREATE_AT },
        {
          ...createSocialLinkDraft("row-4"),
          platform: "FACEBOOK",
          url: "https://facebook.com/estudioaurora",
          confirmedAt: CREATE_AT,
        },
      ],
    },
  };
}
