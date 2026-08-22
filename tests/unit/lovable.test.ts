import { describe, expect, it } from "vitest";
import {
  buildLovableBriefing,
  buildLovableBuildUrl,
  buildLovableMasterPrompt,
  collectLovablePhotos,
  LOVABLE_PROMPT_MAX,
  LOVABLE_REFERENCE_MAX,
} from "../../src/lib/lovable";
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
  socialLinks: JSON.stringify(["https://instagram.com/padaria.aurora"]),
  website: null,
  latitude: -3.7319,
  longitude: -38.5267,
};

const officialPhoto = {
  url: "https://cdn.exemplo.com/fachada.jpg",
  alt: "Fachada da loja",
  kind: "official" as const,
  credit: null,
  creditUrl: "",
};

const stockPhoto = {
  url: "https://images.pexels.com/photos/1/foto.jpg",
  alt: "Imagem ilustrativa de padaria",
  kind: "stock" as const,
  credit: "Foto de Ana via Pexels",
  creditUrl: "https://www.pexels.com/@ana",
};

function content(overrides: Partial<DemoLandingContent> = {}): DemoLandingContent {
  return demoLandingContentSchema.parse({ ...generateDemoLandingContent(lead), ...overrides });
}

describe("photo collection for the briefing", () => {
  it("puts real photos first so they survive the reference budget", () => {
    const photos = collectLovablePhotos(
      content({
        heroImageUrl: stockPhoto.url,
        heroImageKind: "stock",
        galleryImages: [officialPhoto],
      }),
    );

    expect(photos.map((photo) => photo.kind)).toEqual(["official", "stock"]);
  });

  it("drops unsafe and duplicated addresses", () => {
    const photos = collectLovablePhotos(
      content({
        heroImageUrl: officialPhoto.url,
        galleryImages: [officialPhoto, { ...officialPhoto, alt: "Repetida" }],
      }),
    );

    expect(photos).toHaveLength(1);
  });
});

describe("master prompt", () => {
  it("carries only confirmed record data", () => {
    const prompt = buildLovableMasterPrompt({ content: content() });

    expect(prompt).toContain("Padaria Aurora");
    expect(prompt).toContain("Rua Central, 10");
    expect(prompt).toContain("+55 85 99999 9999");
    expect(prompt).toContain("-3.7319, -38.5267");
    expect(prompt).toContain("instagram.com/padaria.aurora");
  });

  it("forbids the invented claims the module bans everywhere else", () => {
    const prompt = buildLovableMasterPrompt({ content: content() }).toLowerCase();

    for (const forbidden of [
      "avaliações",
      "depoimentos",
      "prêmios",
      "preços",
      "horários de funcionamento",
      "tempo de mercado",
      "garantias",
    ]) {
      expect(prompt).toContain(forbidden);
    }
    expect(prompt).toContain("não invente");
  });

  it("tells the model not to build sections with no confirmed data", () => {
    const prompt = buildLovableMasterPrompt({ content: content({ services: [] }) });

    expect(prompt).toContain("NÃO crie uma seção de serviços");
  });

  it("separates real photos from illustrative ones", () => {
    const prompt = buildLovableMasterPrompt({
      content: content({ galleryImages: [officialPhoto, stockPhoto] }),
    });

    const realSection = prompt.indexOf("Fotos reais do estabelecimento");
    const stockSection = prompt.indexOf("NÃO são fotos deste negócio");

    expect(realSection).toBeGreaterThan(-1);
    expect(stockSection).toBeGreaterThan(realSection);
    expect(prompt.slice(realSection, stockSection)).toContain(officialPhoto.url);
    expect(prompt.slice(realSection, stockSection)).not.toContain(stockPhoto.url);
    expect(prompt.slice(stockSection)).toContain(stockPhoto.url);
  });

  it("says there is no phone instead of leaving the field open", () => {
    const withoutPhone = content();
    const prompt = buildLovableMasterPrompt({
      content: demoLandingContentSchema.parse({
        ...withoutPhone,
        businessSnapshot: { ...withoutPhone.businessSnapshot!, phoneE164: null },
      }),
    });

    expect(prompt).toContain("Telefone: não informado");
    expect(prompt).toContain("Não crie botão de telefone nem invente número");
  });

  it("keeps the demonstration notice", () => {
    expect(buildLovableMasterPrompt({ content: content() })).toContain(
      "Demonstração não oficial",
    );
  });

  it("never exceeds the provider limit", () => {
    const huge = content({
      about: "a".repeat(1_200),
      benefits: Array.from({ length: 8 }, () => "b".repeat(180)),
      services: Array.from({ length: 12 }, () => "c".repeat(180)),
    });

    expect(buildLovableMasterPrompt({ content: huge }).length).toBeLessThanOrEqual(
      LOVABLE_PROMPT_MAX,
    );
  });
});

describe("build with url", () => {
  it("puts every parameter in the hash fragment", () => {
    const url = buildLovableBuildUrl({
      prompt: "Crie uma landing page",
      images: ["https://cdn.exemplo.com/a.jpg"],
      htmlRefs: ["https://nox.example.com/demo/abc"],
    });

    expect(url.startsWith("https://lovable.dev/en?autosubmit=true#")).toBe(true);
    const fragment = url.slice(url.indexOf("#") + 1);
    expect(fragment).toContain("prompt=Crie%20uma%20landing%20page");
    expect(fragment).toContain("images=https%3A%2F%2Fcdn.exemplo.com%2Fa.jpg");
    expect(fragment).toContain("html=https%3A%2F%2Fnox.example.com%2Fdemo%2Fabc");
  });

  /**
   * A Portuguese browser makes lovable.dev redirect "/" to "/pt-br/pt-br", which
   * 404s and swallows the captured prompt. The explicit /en path skips the
   * locale redirect entirely.
   */
  it("uses the locale-neutral path so a pt-BR browser is not redirected into a 404", () => {
    const url = buildLovableBuildUrl({ prompt: "x" });

    expect(new URL(url).pathname).toBe("/en");
  });

  /** Lovable reads repeated keys; a comma-joined list is dropped as invalid. */
  it("repeats the key for each image instead of joining them", () => {
    const url = buildLovableBuildUrl({
      prompt: "x",
      images: ["https://cdn.exemplo.com/a.jpg", "https://cdn.exemplo.com/b.jpg"],
      htmlRefs: ["https://nox.example.com/demo/abc"],
    });
    const fragment = url.slice(url.indexOf("#") + 1);
    const params = new URLSearchParams(fragment);

    expect(params.getAll("images")).toEqual([
      "https://cdn.exemplo.com/a.jpg",
      "https://cdn.exemplo.com/b.jpg",
    ]);
    expect(params.getAll("html")).toEqual(["https://nox.example.com/demo/abc"]);
    expect(fragment).not.toContain(",");
  });

  it("refuses references that are not safe HTTPS addresses", () => {
    const url = buildLovableBuildUrl({
      prompt: "x",
      images: ["http://inseguro.com/a.jpg", "javascript:alert(1)", "https://ok.com/b.jpg"],
      htmlRefs: ["http://inseguro.com/pagina"],
    });

    expect(url).toContain(encodeURIComponent("https://ok.com/b.jpg"));
    expect(url).not.toContain("inseguro.com");
    expect(url).not.toContain("javascript");
    expect(url).not.toContain("html=");
  });

  it("shares the reference budget between pages and images", () => {
    const url = buildLovableBuildUrl({
      prompt: "x",
      images: Array.from({ length: 20 }, (_, index) => `https://cdn.exemplo.com/${index}.jpg`),
      htmlRefs: ["https://nox.example.com/demo/abc"],
    });

    const params = new URLSearchParams(url.slice(url.indexOf("#") + 1));
    expect(params.getAll("images")).toHaveLength(LOVABLE_REFERENCE_MAX - 1);
  });

  it("truncates a prompt beyond the provider limit", () => {
    const url = buildLovableBuildUrl({ prompt: "a".repeat(LOVABLE_PROMPT_MAX + 500) });
    const encoded = url.slice(url.indexOf("prompt=") + "prompt=".length);

    expect(decodeURIComponent(encoded)).toHaveLength(LOVABLE_PROMPT_MAX);
  });
});

describe("briefing assembly", () => {
  it("counts the photo kinds and attaches the approved page", () => {
    const briefing = buildLovableBriefing({
      content: content({ galleryImages: [officialPhoto, stockPhoto] }),
      demoUrl: "https://nox.example.com/demo/abc",
    });

    expect(briefing.officialPhotoCount).toBe(1);
    expect(briefing.stockPhotoCount).toBe(1);
    expect(briefing.images).toEqual([officialPhoto.url, stockPhoto.url]);
    expect(briefing.htmlRefs).toEqual(["https://nox.example.com/demo/abc"]);
  });

  it("skips a local preview address as reference", () => {
    const briefing = buildLovableBriefing({
      content: content(),
      demoUrl: "http://localhost:3000/demo/abc",
    });

    expect(briefing.htmlRefs).toEqual([]);
  });
});
