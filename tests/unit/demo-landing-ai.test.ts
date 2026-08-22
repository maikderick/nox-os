import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDemoAiFacts,
  buildDemoAiJsonSchema,
  buildDemoAiUserPrompt,
  DEMO_AI_EDITORIAL_FIELDS,
  DEMO_AI_PROTECTED_FIELDS,
  demoLandingAiDraftSchema,
  findFabricationRisks,
  mergeDemoAiDraft,
  validateDemoAiDraft,
  type DemoLandingAiDraft,
} from "../../src/lib/demo-landing-ai";
import {
  DemoAiError,
  getDemoAiConfig,
  improveDemoLandingContent,
  toDemoAiError,
} from "../../src/lib/anthropic";
import { generateDemoLandingContent } from "../../src/lib/demo-landing";
import {
  demoLandingContentSchema,
  type DemoLandingContent,
} from "../../src/lib/demo-landing-schema";

const lead = {
  name: "Padaria Aurora",
  category: "Padaria",
  address: "Rua Central, 10",
  neighborhood: "Centro",
  city: "Fortaleza",
  state: "CE",
  postalCode: "60000-000",
  phoneE164: "+5585999999999",
  socialLinks: JSON.stringify(["https://instagram.com/padaria-aurora"]),
  website: null,
  latitude: -3.7319,
  longitude: -38.5267,
};

function currentContent(overrides: Partial<DemoLandingContent> = {}): DemoLandingContent {
  return demoLandingContentSchema.parse({
    ...generateDemoLandingContent(lead),
    ...overrides,
  });
}

function validDraft(overrides: Partial<DemoLandingAiDraft> = {}): DemoLandingAiDraft {
  return {
    headline: "Conheça a Padaria Aurora",
    subheadline: "Padaria no Centro, em Fortaleza. Uma apresentação digital clara e direta.",
    aboutTitle: "Sobre a Padaria Aurora",
    about:
      "A Padaria Aurora atua na categoria padaria e tem localização informada no Centro, em Fortaleza. Esta demonstração reúne as informações essenciais em uma página organizada.",
    factsTitle: "Informações essenciais",
    benefits: ["Categoria: padaria", "Localização: Fortaleza — CE"],
    servicesTitle: "Serviços",
    servicesIntro: "Consulte o estabelecimento para confirmar o que está disponível.",
    services: [],
    galleryTitle: "Uma visão mais completa",
    galleryIntro: "Esta seção foi preparada para receber fotos oficiais ou autorizadas.",
    processTitle: "Como conhecer",
    processIntro: "Use as informações desta demonstração como ponto de partida.",
    processSteps: [
      "Confira a categoria informada.",
      "Verifique a localização informada.",
      "Confirme os detalhes com o estabelecimento.",
    ],
    faqTitle: "Dúvidas frequentes",
    faqs: [
      {
        question: "Esta é a página oficial?",
        answer:
          "Não. Esta é uma demonstração não oficial criada para apresentar uma possível presença digital.",
      },
    ],
    contactTitle: "Informações de contato",
    contactText: "Valide os canais informados diretamente com o estabelecimento.",
    finalCtaTitle: "Próximo passo",
    finalCtaText: "Confirme os detalhes diretamente com o estabelecimento.",
    ctaLabel: "Ver informações",
    primaryColor: "#dc2626",
    accentColor: "#f59e0b",
    ...overrides,
  };
}

describe("assisted draft schema", () => {
  it("accepts a clean draft and exposes the exact editorial allowlist", () => {
    expect(demoLandingAiDraftSchema.safeParse(validDraft()).success).toBe(true);
    expect([...DEMO_AI_EDITORIAL_FIELDS].sort()).toEqual(
      [
        "about",
        "aboutTitle",
        "accentColor",
        "benefits",
        "contactText",
        "contactTitle",
        "ctaLabel",
        "factsTitle",
        "faqTitle",
        "faqs",
        "finalCtaText",
        "finalCtaTitle",
        "galleryIntro",
        "galleryTitle",
        "headline",
        "primaryColor",
        "processIntro",
        "processSteps",
        "processTitle",
        "services",
        "servicesIntro",
        "servicesTitle",
        "subheadline",
      ].sort(),
    );
  });

  it("never lets the model reach protected fields", () => {
    for (const field of DEMO_AI_PROTECTED_FIELDS) {
      expect(DEMO_AI_EDITORIAL_FIELDS).not.toContain(field as never);
      const parsed = demoLandingAiDraftSchema.safeParse({
        ...validDraft(),
        [field]: "qualquer coisa",
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects malformed answers instead of falling back to defaults", () => {
    const missingField = { ...validDraft() } as Record<string, unknown>;
    delete missingField.headline;

    expect(demoLandingAiDraftSchema.safeParse(missingField).success).toBe(false);
    expect(
      demoLandingAiDraftSchema.safeParse(validDraft({ primaryColor: "vermelho" })).success,
    ).toBe(false);
    expect(
      demoLandingAiDraftSchema.safeParse(validDraft({ ctaLabel: "Compre agora" as never })).success,
    ).toBe(false);
    expect(
      demoLandingAiDraftSchema.safeParse(
        validDraft({ benefits: Array.from({ length: 9 }, (_, index) => `Item ${index}`) }),
      ).success,
    ).toBe(false);
    expect(
      demoLandingAiDraftSchema.safeParse(validDraft({ processSteps: ["Só uma etapa"] })).success,
    ).toBe(false);
  });

  it("publishes a JSON schema aligned with the validated contract", () => {
    const schema = buildDemoAiJsonSchema() as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual([...DEMO_AI_EDITORIAL_FIELDS].sort());
    for (const field of DEMO_AI_PROTECTED_FIELDS) {
      expect(schema.properties[field]).toBeUndefined();
    }
  });
});

describe("fabrication guard", () => {
  it("accepts copy grounded in the lead record", () => {
    expect(findFabricationRisks(validDraft())).toEqual([]);
  });

  const forbidden: Array<[string, Partial<DemoLandingAiDraft>]> = [
    ["avaliacao", { about: "Avaliação média de 4,8 estrelas entre os clientes." }],
    ["depoimento", { about: "Os clientes dizem que o atendimento é impecável." }],
    ["premio", { headline: "Padaria premiada da região" }],
    ["preco", { finalCtaText: "Pães a partir de R$ 5,00 com desconto na primeira compra." }],
    ["horario", { contactText: "Funcionamento de segunda a sábado, das 7h às 19h." }],
    ["experiencia", { about: "São mais de 20 anos de experiência no bairro." }],
    ["garantia", { subheadline: "Qualidade garantida em 100% dos produtos." }],
    ["superlativo", { headline: "A melhor padaria de Fortaleza" }],
    ["contato", { contactText: "Fale conosco pelo 85 99999-9999." }],
    ["link", { galleryIntro: "Veja as fotos em https://exemplo.com/galeria" }],
    ["email", { contactText: "Escreva para contato@padaria.com.br." }],
    ["equipe", { about: "Nossa equipe altamente qualificada cuida de cada detalhe." }],
  ];

  it.each(forbidden)("blocks invented content: %s", (rule, overrides) => {
    const risks = findFabricationRisks(validDraft(overrides));
    expect(risks.map((risk) => risk.rule)).toContain(rule);
  });

  it("turns risks into corrections without touching the demo", () => {
    const result = validateDemoAiDraft(validDraft({ headline: "A melhor padaria de Fortaleza" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.corrections.join(" ")).toContain("headline");
  });

  it("reports schema issues as corrections", () => {
    const result = validateDemoAiDraft({ headline: "Só isso" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.corrections.length).toBeGreaterThan(0);
  });
});

describe("assisted draft merge", () => {
  it("keeps the protected snapshot, images and hero untouched", () => {
    const current = currentContent({
      heroImageUrl: "https://cdn.exemplo.com/hero.jpg",
      galleryImages: [{ url: "https://cdn.exemplo.com/foto.jpg", alt: "Fachada oficial" }],
    });

    const { content } = mergeDemoAiDraft({ current, draft: validDraft() });

    expect(content.businessSnapshot).toEqual(current.businessSnapshot);
    expect(content.heroImageUrl).toBe("https://cdn.exemplo.com/hero.jpg");
    expect(content.galleryImages).toEqual(current.galleryImages);
    expect(content.headline).toBe("Conheça a Padaria Aurora");
  });

  it("drops services that were never confirmed on the lead", () => {
    const current = currentContent({ services: ["Pães artesanais", "Bolos sob encomenda"] });

    const { content, droppedServices } = mergeDemoAiDraft({
      current,
      draft: validDraft({
        services: ["  bolos sob encomenda ", "Buffet de festas", "Pães artesanais"],
      }),
    });

    expect(content.services).toEqual(["Bolos sob encomenda", "Pães artesanais"]);
    expect(droppedServices).toEqual(["Buffet de festas"]);
  });

  it("returns an empty service list when nothing is confirmed", () => {
    const current = currentContent({ services: [] });

    const { content, droppedServices } = mergeDemoAiDraft({
      current,
      draft: validDraft({ services: ["Entrega em domicílio"] }),
    });

    expect(content.services).toEqual([]);
    expect(droppedServices).toEqual(["Entrega em domicílio"]);
  });

  it("produces content that still satisfies the public schema", () => {
    const current = currentContent();
    const { content, changedFields } = mergeDemoAiDraft({ current, draft: validDraft() });

    expect(demoLandingContentSchema.safeParse(content).success).toBe(true);
    expect(changedFields).toContain("headline");
    expect(changedFields).not.toContain("services");
  });
});

describe("prompt construction", () => {
  it("sends facts without repeating phone or address values", () => {
    const current = currentContent();
    const facts = buildDemoAiFacts(current);
    const prompt = buildDemoAiUserPrompt({ facts, current });

    expect(facts.hasPhone).toBe(true);
    expect(facts.hasAddress).toBe(true);
    expect(prompt).not.toContain("+5585999999999");
    expect(prompt).not.toContain("Rua Central, 10");
    expect(prompt).not.toContain("60000-000");
    expect(prompt).not.toContain("instagram.com");
    expect(prompt).toContain("Padaria Aurora");
  });

  it("adds the rejection reasons on a retry", () => {
    const current = currentContent();
    const prompt = buildDemoAiUserPrompt({
      facts: buildDemoAiFacts(current),
      current,
      corrections: ["Campo headline contém superlativo sem comprovação."],
    });

    expect(prompt).toContain("superlativo sem comprovação");
  });
});

describe("improvement orchestration", () => {
  it("returns a merged draft on the first valid answer", async () => {
    const current = currentContent();
    const call = vi.fn().mockResolvedValue(validDraft());

    const result = await improveDemoLandingContent({
      current,
      facts: buildDemoAiFacts(current),
      call,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.content.headline).toBe("Conheça a Padaria Aurora");
  });

  it("retries once with corrections when the answer invents facts", async () => {
    const current = currentContent();
    const call = vi
      .fn()
      .mockResolvedValueOnce(validDraft({ headline: "A melhor padaria de Fortaleza" }))
      .mockResolvedValueOnce(validDraft());

    const result = await improveDemoLandingContent({
      current,
      facts: buildDemoAiFacts(current),
      call,
    });

    expect(call).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    const retryPrompt = (call.mock.calls[1][0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain("rejeitada pela validação automática");
  });

  it("leaves the demo untouched when every answer is invalid", async () => {
    const current = currentContent();
    const snapshot = JSON.stringify(current);
    const call = vi.fn().mockResolvedValue({ headline: "incompleto" });

    await expect(
      improveDemoLandingContent({ current, facts: buildDemoAiFacts(current), call }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});

describe("integration configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports the integration as unavailable without a key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const config = getDemoAiConfig();

    expect(config.configured).toBe(false);
    expect(config.model).toBe("claude-opus-5");
    expect(Object.values(config)).not.toContain(process.env.ANTHROPIC_API_KEY);
  });

  it("keeps the model and limits configurable by environment", () => {
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    process.env.ANTHROPIC_TIMEOUT_MS = "9000";
    process.env.DEMO_AI_HOURLY_LIMIT = "3";

    const config = getDemoAiConfig();

    expect(config).toMatchObject({
      configured: true,
      model: "claude-sonnet-5",
      timeoutMs: 9_000,
      hourlyLimit: 3,
    });
  });

  it("falls back to safe values for malformed numeric settings", () => {
    process.env.ANTHROPIC_TIMEOUT_MS = "-1";
    process.env.ANTHROPIC_MAX_TOKENS = "não é número";
    process.env.DEMO_AI_HOURLY_LIMIT = "999999";

    const config = getDemoAiConfig();

    expect(config.timeoutMs).toBe(45_000);
    expect(config.maxTokens).toBe(8_000);
    expect(config.hourlyLimit).toBe(500);
  });

  it("maps unexpected failures to a generic code without leaking details", () => {
    const mapped = toDemoAiError(new Error("x-api-key sk-ant-secret rejeitada"));

    expect(mapped).toBeInstanceOf(DemoAiError);
    expect(mapped.code).toBe("upstream");
    expect(mapped.message).not.toContain("sk-ant");
  });
});
