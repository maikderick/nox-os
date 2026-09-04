import { describe, expect, it } from "vitest";
import {
  findInstagramProfile,
  instagramEmbedUrl,
  instagramPermalink,
  isInstagramPostUrl,
  parseInstagramPostUrl,
} from "../../src/lib/instagram";
import {
  demoLandingContentSchema,
  parseDemoLandingContent,
} from "../../src/lib/demo-landing-schema";
import { generateDemoLandingContent } from "../../src/lib/demo-landing";
import { mergeDemoAiDraft, DEMO_AI_PROTECTED_FIELDS } from "../../src/lib/demo-landing-ai";

const lead = {
  name: "Padaria Aurora",
  category: "Padaria",
  city: "Fortaleza",
  state: "CE",
  phoneE164: "+5585999999999",
  socialLinks: JSON.stringify(["https://instagram.com/padaria.aurora"]),
  website: null,
  latitude: -3.7319,
  longitude: -38.5267,
};

describe("Instagram post URL parsing", () => {
  it.each([
    ["https://www.instagram.com/p/CxAbC12dEfG/", "CxAbC12dEfG", "p"],
    ["https://instagram.com/p/CxAbC12dEfG", "CxAbC12dEfG", "p"],
    ["https://www.instagram.com/reel/DzZ_9-yQw1x/", "DzZ_9-yQw1x", "reel"],
    ["https://www.instagram.com/padaria.aurora/p/CxAbC12dEfG/", "CxAbC12dEfG", "p"],
    ["  https://www.instagram.com/p/CxAbC12dEfG/?igshid=abc  ", "CxAbC12dEfG", "p"],
  ])("accepts %s", (input, shortcode, kind) => {
    expect(parseInstagramPostUrl(input)).toEqual({ shortcode, kind });
  });

  it.each([
    ["http://www.instagram.com/p/CxAbC12dEfG/"],
    ["https://instagram.com.evil.com/p/CxAbC12dEfG/"],
    ["https://user:senha@instagram.com/p/CxAbC12dEfG/"],
    ["https://www.instagram.com/padaria.aurora/"],
    ["https://www.instagram.com/p/"],
    ["https://www.instagram.com/p/tem espaco/"],
    ["https://www.facebook.com/p/CxAbC12dEfG/"],
    ["javascript:alert(1)"],
    [""],
  ])("rejects %s", (input) => {
    expect(parseInstagramPostUrl(input)).toBeNull();
    expect(isInstagramPostUrl(input)).toBe(false);
  });

  it("rebuilds the embed address from the parsed shortcode only", () => {
    const ref = parseInstagramPostUrl(
      "https://www.instagram.com/p/CxAbC12dEfG/?utm_source=algo&igshid=xyz",
    );

    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(instagramEmbedUrl(ref)).toBe(
      "https://www.instagram.com/p/CxAbC12dEfG/embed/captioned/",
    );
    expect(instagramEmbedUrl(ref)).not.toContain("utm_source");
    expect(instagramPermalink(ref)).toBe("https://www.instagram.com/p/CxAbC12dEfG/");
  });
});

describe("finding the profile already captured on the lead", () => {
  it("reads the username from the snapshot social links", () => {
    expect(findInstagramProfile(["https://instagram.com/padaria.aurora"])).toEqual({
      username: "padaria.aurora",
      url: "https://www.instagram.com/padaria.aurora/",
    });
  });

  it("ignores other networks, post links and unsafe addresses", () => {
    expect(findInstagramProfile(["https://facebook.com/padaria"])).toBeNull();
    expect(findInstagramProfile(["https://www.instagram.com/p/CxAbC12dEfG/"])).toBeNull();
    expect(findInstagramProfile(["http://instagram.com/padaria"])).toBeNull();
    expect(findInstagramProfile([])).toBeNull();
  });

  it("picks the Instagram profile out of a mixed list", () => {
    expect(
      findInstagramProfile([
        "https://facebook.com/padaria",
        "https://www.instagram.com/padaria.aurora/",
      ])?.username,
    ).toBe("padaria.aurora");
  });
});

describe("Instagram posts inside the demo content", () => {
  it("defaults to none and stays valid for demos stored before the field existed", () => {
    const legacy = { ...generateDemoLandingContent(lead) } as Record<string, unknown>;
    delete legacy.instagramPosts;
    delete legacy.instagramTitle;
    delete legacy.instagramIntro;

    const parsed = parseDemoLandingContent(JSON.stringify(legacy));

    expect(parsed.instagramPosts).toEqual([]);
    expect(parsed.instagramTitle).toBe("No Instagram");
  });

  it("refuses anything that is not a public post address", () => {
    const base = generateDemoLandingContent(lead);

    expect(
      demoLandingContentSchema.safeParse({
        ...base,
        instagramPosts: ["https://www.instagram.com/p/CxAbC12dEfG/"],
      }).success,
    ).toBe(true);
    expect(
      demoLandingContentSchema.safeParse({
        ...base,
        instagramPosts: ["https://evil.example.com/p/CxAbC12dEfG/"],
      }).success,
    ).toBe(false);
    expect(
      demoLandingContentSchema.safeParse({
        ...base,
        instagramPosts: Array.from(
          { length: 4 },
          (_, index) => `https://www.instagram.com/p/CxAbC12dEf${index}/`,
        ),
      }).success,
    ).toBe(false);
  });

  it("keeps the posts out of Claude's reach", () => {
    expect(DEMO_AI_PROTECTED_FIELDS).toContain("instagramPosts");

    const current = demoLandingContentSchema.parse({
      ...generateDemoLandingContent(lead),
      instagramPosts: ["https://www.instagram.com/p/CxAbC12dEfG/"],
    });

    const { content } = mergeDemoAiDraft({
      current,
      draft: {
        headline: "Conheça a Padaria Aurora",
        subheadline: "Padaria no Centro. Uma página clara e direta.",
        aboutTitle: "Sobre a Padaria Aurora",
        about: "A Padaria Aurora atua na categoria padarias e tem localização informada.",
        factsTitle: "Informações essenciais",
        benefits: ["Categoria: padaria"],
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
        faqs: [],
        contactTitle: "Informações de contato",
        contactText: "Valide os canais informados diretamente com o estabelecimento.",
        finalCtaTitle: "Próximo passo",
        finalCtaText: "Confirme os detalhes diretamente com o estabelecimento.",
        ctaLabel: "Ver informações" as const,
        primaryColor: "#dc2626",
        accentColor: "#f59e0b",
      },
    });

    expect(content.instagramPosts).toEqual(current.instagramPosts);
  });
});
