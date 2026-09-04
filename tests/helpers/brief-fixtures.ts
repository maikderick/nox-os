import type { SiteBriefV2 } from "@/lib/site-factory/brief-schema";

/**
 * The briefing of a project that is already live.
 *
 * Shared by the editor's tests because both of them ask the same question from
 * different ends: the page test that it arrives on screen, the DOM test that
 * it leaves again unchanged.
 */

const AT = "2026-08-25T12:00:00.000Z";

function fact(value: string, source: "LEAD" | "OPERADOR" | "CLIENTE" = "OPERADOR") {
  return { value, source, confirmedAt: AT } as const;
}

export function storedBrief(): SiteBriefV2 {
  return {
    schemaVersion: 2,
    businessName: fact("Zen Comida Japonesa", "LEAD"),
    sector: fact("Restaurante japonês"),
    city: fact("Fortaleza"),
    about: fact("A Zen serve culinária japonesa no centro de Fortaleza, com balcão de sushi."),
    objective: fact("Receber pedidos pelo WhatsApp a partir do site."),
    audience: fact("Moradores e escritórios da região central."),
    positioning: fact("Balcão de sushi e pratos quentes preparados na hora."),
    differentiators: [fact("Balcão de sushi à vista")],
    desiredSections: ["Início", "Sobre", "Serviços", "Contato"],
    visualDirection: fact("Sóbrio, escuro e legível."),
    notes: fact("Cliente prefere ser avisado antes de qualquer publicação."),
    services: [
      {
        id: "rodizio-de-sushi",
        name: fact("Rodízio de sushi"),
        summary: fact("Rodízio servido no balcão, com peças preparadas na hora."),
        body: [fact("O rodízio é servido no jantar, de quarta a domingo.")],
        price: fact("R$ 120"),
        relatedIds: [],
        featured: true,
      },
    ],
    publicContact: {
      phone: { value: "+558533334444", source: "OPERADOR", confirmedAt: AT },
      whatsapp: { value: "+5585999990000", source: "LEAD", confirmedAt: AT },
      email: null,
      address: {
        value: {
          street: "Rua das Flores",
          number: "120",
          complement: null,
          neighborhood: "Centro",
          city: "Fortaleza",
          state: "CE",
          postalCode: null,
          country: "Brasil",
        },
        source: "LEAD",
        confirmedAt: AT,
      },
      coordinates: {
        value: { latitude: -3.7319, longitude: -38.5267 },
        source: "LEAD",
        confirmedAt: AT,
      },
      openingHours: {
        value: [{ dayOfWeek: "QUARTA", opens: "18:00", closes: "23:00" }],
        source: "CLIENTE",
        confirmedAt: AT,
      },
      socialLinks: [
        {
          value: {
            platform: "INSTAGRAM",
            url: "https://instagram.com/zencomidajaponesa",
            label: "@zencomidajaponesa",
          },
          source: "LEAD",
          confirmedAt: AT,
        },
      ],
    },
    metaDescription: fact("Culinária japonesa no centro de Fortaleza, com balcão de sushi."),
  };
}

/** A briefing from before v2: services are names, and nothing else. */
export function legacyBrief() {
  return {
    schemaVersion: 1,
    businessName: fact("Padaria Aurora"),
    sector: fact("Padaria"),
    city: null,
    objective: fact("Apresentar informações confirmadas sobre o negócio."),
    audience: fact("Pessoas que procuram uma padaria na região."),
    positioning: fact("Comunicação clara sobre o negócio."),
    services: [fact("Pães artesanais")],
    differentiators: [],
    desiredSections: ["Início", "Sobre", "Contato"],
    visualDirection: fact("Layout sóbrio e legível."),
    notes: null,
  };
}
