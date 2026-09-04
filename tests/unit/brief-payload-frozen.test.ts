import { describe, expect, it, vi } from "vitest";

import { buildBriefV2 } from "@/lib/site-factory/brief-draft";
import { briefFactsHash } from "@/lib/site-factory/brief-service";
import { siteBriefSchema } from "@/lib/site-factory/brief-schema";

import { createDraft } from "./frozen-draft";

/**
 * The payload the create flow sends, frozen.
 *
 * The briefing editor changed `buildPublicContact` — coordinates are carried
 * instead of zeroed, and provenance is reused by value — and every one of those
 * changes had to leave creating a project byte-for-byte as it was. Reasoning
 * says it does: a fresh draft carries no stored briefing and no coordinates, so
 * every new branch falls back to the old constant. This file is the part that
 * keeps saying so after the reasoning is forgotten.
 *
 * If this literal has to change, the question to answer first is which stored
 * briefing's facts hash changes with it.
 */
const CREATE_PAYLOAD =
  {
    "schemaVersion": 2,
    "businessName": {
      "value": "Estúdio Aurora",
      "source": "LEAD",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "sector": {
      "value": "Estética",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "city": {
      "value": "Fortaleza",
      "source": "LEAD",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "about": {
      "value": "O Estúdio Aurora atende estética facial e corporal em Fortaleza, em sala privativa.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "objective": {
      "value": "Criar um site completo para apresentar o negócio e facilitar novos contatos.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "audience": {
      "value": "Pessoas que procuram os serviços do negócio na região.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "positioning": {
      "value": "Apresentar informações confirmadas com clareza e credibilidade.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "differentiators": [
      {
        "value": "Equipe própria",
        "source": "OPERADOR",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      },
      {
        "value": "Sala privativa",
        "source": "OPERADOR",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      }
    ],
    "desiredSections": [
      "Início",
      "Sobre",
      "Serviços",
      "Contato"
    ],
    "visualDirection": {
      "value": "Visual contemporâneo, legível e adequado ao setor.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "notes": {
      "value": "Cliente prefere ser avisado antes de qualquer publicação.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    },
    "services": [
      {
        "id": "limpeza-de-pele",
        "name": {
          "value": "Limpeza de pele",
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        "summary": {
          "value": "Procedimento facial realizado na própria clínica.",
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        "body": [
          {
            "value": "A sessão é conduzida por profissional da clínica.",
            "source": "OPERADOR",
            "confirmedAt": "2026-09-04T11:30:00.000Z"
          },
          {
            "value": "O procedimento é agendado com antecedência.",
            "source": "OPERADOR",
            "confirmedAt": "2026-09-04T11:30:00.000Z"
          }
        ],
        "price": {
          "value": "R$ 180",
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        "relatedIds": [],
        "featured": false
      },
      {
        "id": "massagem-relaxante",
        "name": {
          "value": "Massagem relaxante",
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        "summary": {
          "value": "Sessão de massagem conduzida no estúdio.",
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        "body": [
          {
            "value": "A sessão acontece em sala privativa.",
            "source": "OPERADOR",
            "confirmedAt": "2026-09-04T11:30:00.000Z"
          }
        ],
        "price": null,
        "relatedIds": [
          "limpeza-de-pele"
        ],
        "featured": true
      }
    ],
    "publicContact": {
      "phone": {
        "value": "+5585999990000",
        "source": "LEAD",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      },
      "whatsapp": {
        "value": "+5585999990000",
        "source": "LEAD",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      },
      "email": {
        "value": "contato@estudioaurora.com.br",
        "source": "OPERADOR",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      },
      "address": {
        "value": {
          "street": "Rua das Flores",
          "number": "120",
          "complement": null,
          "neighborhood": "Aldeota",
          "city": "Fortaleza",
          "state": "CE",
          "postalCode": "60000000",
          "country": "Brasil"
        },
        "source": "LEAD",
        "confirmedAt": "2026-09-04T11:30:00.000Z"
      },
      "coordinates": null,
      "openingHours": {
        "value": [
          {
            "dayOfWeek": "SEGUNDA",
            "opens": "09:00",
            "closes": "18:00"
          },
          {
            "dayOfWeek": "SABADO",
            "opens": "09:00",
            "closes": "13:00"
          }
        ],
        "source": "OPERADOR",
        "confirmedAt": "2026-09-04T12:00:00.000Z"
      },
      "socialLinks": [
        {
          "value": {
            "platform": "INSTAGRAM",
            "url": "https://instagram.com/estudioaurora",
            "label": "@estudioaurora"
          },
          "source": "LEAD",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        },
        {
          "value": {
            "platform": "FACEBOOK",
            "url": "https://facebook.com/estudioaurora",
            "label": null
          },
          "source": "OPERADOR",
          "confirmedAt": "2026-09-04T11:30:00.000Z"
        }
      ]
    },
    "metaDescription": {
      "value": "Estúdio de estética em Fortaleza com atendimento individual.",
      "source": "OPERADOR",
      "confirmedAt": "2026-09-04T11:30:00.000Z"
    }
  };

describe("payload do fluxo de criação", () => {
  it("é exatamente o que era, campo a campo", () => {
    vi.useFakeTimers();
    // The week is stamped when the payload is built; every other fact carries
    // the moment it was confirmed in the form.
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    const built = buildBriefV2(createDraft());
    vi.useRealTimers();

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief).toEqual(CREATE_PAYLOAD);
  });

  it("é aceito pelo schema e tem um facts hash estável", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    const built = buildBriefV2(createDraft());
    vi.useRealTimers();
    if (!built.ok) throw new Error(built.issues.map((issue) => issue.message).join(" | "));

    expect(() => siteBriefSchema.parse(built.brief)).not.toThrow();
    expect(briefFactsHash(built.brief)).toBe(briefFactsHash(CREATE_PAYLOAD));
  });

  it("não carrega coordenada nem reusa proveniência: não há briefing de origem", () => {
    const draft = createDraft();
    expect(draft.stored ?? null).toBeNull();
    expect(draft.contact.coordinates ?? null).toBeNull();
  });
});
