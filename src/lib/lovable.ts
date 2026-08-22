import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  isSafeDemoHttpsUrl,
  type DemoLandingContent,
} from "./demo-landing-schema";
import { instagramPermalink, parseInstagramPostUrl } from "./instagram";

/** Documented limits of Lovable's Build with URL feature. */
export const LOVABLE_BUILD_BASE = "https://lovable.dev/?autosubmit=true";
export const LOVABLE_PROMPT_MAX = 50_000;
export const LOVABLE_REFERENCE_MAX = 10;

export type LovablePhotoRef = {
  url: string;
  alt: string;
  /** `official` is a real photo of this business; `stock` is licensed and illustrative. */
  kind: "official" | "stock";
};

export type LovableBriefing = {
  prompt: string;
  images: string[];
  htmlRefs: string[];
  officialPhotoCount: number;
  stockPhotoCount: number;
};

function line(label: string, value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? `- ${label}: ${trimmed}` : null;
}

function block(title: string, body: Array<string | null>): string[] {
  const filled = body.filter((item): item is string => Boolean(item));
  return filled.length ? [`## ${title}`, ...filled, ""] : [];
}

function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** Photos are split so the prompt can never present a stock image as the business's own. */
export function collectLovablePhotos(content: DemoLandingContent): LovablePhotoRef[] {
  const photos: LovablePhotoRef[] = [];

  if (content.heroImageUrl.trim() && isSafeDemoHttpsUrl(content.heroImageUrl)) {
    photos.push({
      url: content.heroImageUrl.trim(),
      alt: "Imagem principal",
      kind: content.heroImageKind,
    });
  }

  for (const image of content.galleryImages) {
    if (!isSafeDemoHttpsUrl(image.url)) continue;
    photos.push({ url: image.url, alt: image.alt, kind: image.kind });
  }

  // Official photos first: if the reference budget runs out, the real ones survive.
  const ordered = [
    ...photos.filter((photo) => photo.kind === "official"),
    ...photos.filter((photo) => photo.kind === "stock"),
  ];

  const seen = new Set<string>();
  return ordered.filter((photo) => {
    if (seen.has(photo.url)) return false;
    seen.add(photo.url);
    return true;
  });
}

/**
 * Builds the master briefing from confirmed record data only. Every section is
 * omitted when the underlying field is empty, so the model is never handed a
 * placeholder it could turn into a claim.
 */
export function buildLovableMasterPrompt(params: {
  content: DemoLandingContent;
  demoUrl?: string | null;
  photos?: LovablePhotoRef[];
}): string {
  const { content, demoUrl } = params;
  const snapshot = content.businessSnapshot;
  const photos = params.photos ?? collectLovablePhotos(content);
  const official = photos.filter((photo) => photo.kind === "official");
  const stock = photos.filter((photo) => photo.kind === "stock");

  const name = snapshot?.name?.trim() || "";
  const location = [snapshot?.neighborhood, snapshot?.city, snapshot?.state]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");

  const instagramLinks = content.instagramPosts
    .map((postUrl) => parseInstagramPostUrl(postUrl))
    .filter((ref): ref is NonNullable<typeof ref> => ref !== null)
    .map((ref) => instagramPermalink(ref));

  const parts: string[] = [
    `Crie uma landing page de uma página, em português do Brasil, para ${name || "este negócio local"}.`,
    "",
    "REGRA MAIS IMPORTANTE: use SOMENTE os fatos listados abaixo. Eles vêm de um cadastro verificado.",
    "Não invente, não estime e não complete nenhuma informação que não esteja aqui. Especificamente,",
    "é proibido criar: avaliações, notas, estrelas, depoimentos, número de clientes, prêmios,",
    "certificações, preços, promoções, descontos, horários de funcionamento, tempo de mercado, ano de",
    "fundação, garantias, promessas de resultado e serviços que não estejam na lista de serviços",
    "confirmados. Se um dado não estiver aqui, a seção correspondente simplesmente não deve existir.",
    "",
    ...block("Dados verificados do negócio", [
      line("Nome", name),
      line("Categoria", snapshot?.category),
      line("Localização", location),
      line("Endereço", snapshot?.address),
      line("CEP", snapshot?.postalCode),
      snapshot?.phoneE164
        ? `- Telefone: ${formatPhone(snapshot.phoneE164)} (use exatamente este número; o botão de ligar deve usar ${snapshot.phoneE164})`
        : "- Telefone: não informado. Não crie botão de telefone nem invente número.",
      snapshot?.latitude !== null && snapshot?.latitude !== undefined
        ? `- Coordenadas para o mapa: ${snapshot.latitude}, ${snapshot.longitude}`
        : "- Coordenadas: não informadas. Não invente endereço no mapa.",
      snapshot?.socialLinks.length
        ? `- Redes sociais: ${snapshot.socialLinks.join(" | ")}`
        : "- Redes sociais: nenhuma cadastrada.",
    ]),
    ...block("Textos já revisados por uma pessoa (use como base)", [
      line("Título principal", content.headline),
      line("Subtítulo", content.subheadline),
      line(`Seção "${content.aboutTitle}"`, content.about),
      content.benefits.length
        ? `- ${content.factsTitle}:\n${content.benefits.map((item) => `  - ${item}`).join("\n")}`
        : null,
      line("Texto de contato", content.contactText),
      line("Chamada final", `${content.finalCtaTitle} — ${content.finalCtaText}`),
      line("Texto do botão principal", content.ctaLabel),
    ]),
    ...block("Serviços confirmados", [
      content.services.length
        ? content.services.map((service) => `- ${service}`).join("\n")
        : "- Nenhum serviço foi confirmado. NÃO crie uma seção de serviços.",
    ]),
    ...block("Perguntas frequentes confirmadas", [
      content.faqs.length
        ? content.faqs.map((faq) => `- ${faq.question}\n  ${faq.answer}`).join("\n")
        : "- Nenhuma. NÃO invente perguntas frequentes.",
    ]),
    ...block("Fotos reais do estabelecimento", [
      official.length
        ? official.map((photo) => `- ${photo.url} (${photo.alt})`).join("\n")
        : "- Nenhuma foto real disponível.",
    ]),
    ...block("Imagens ilustrativas licenciadas (NÃO são fotos deste negócio)", [
      stock.length
        ? `${stock.map((photo) => `- ${photo.url}`).join("\n")}\n  Se usar alguma, ela precisa aparecer identificada como "Imagem ilustrativa". Nunca escreva ou sugira que retratam este estabelecimento.`
        : "- Nenhuma.",
    ]),
    ...block("Publicações do Instagram do estabelecimento", [
      instagramLinks.length
        ? `${instagramLinks.map((url) => `- ${url}`).join("\n")}\n  Exiba usando o embed oficial do Instagram. Não copie as imagens.`
        : "- Nenhuma.",
    ]),
    ...block("Identidade visual", [
      `- Cor principal: ${content.primaryColor}`,
      `- Cor de destaque: ${content.accentColor}`,
      "- Visual profissional e moderno, com bom contraste e acessibilidade.",
      "- Precisa funcionar bem em telas a partir de 320 px de largura.",
    ]),
    ...block("Estrutura desejada", [
      "- Navegação fixa, hero, apresentação do negócio, diferenciais com base nos fatos acima,",
      "  serviços (só se houver confirmados), galeria (só com as imagens listadas), perguntas",
      "  frequentes (só as confirmadas), contato, mapa (só com as coordenadas informadas),",
      "  redes sociais e rodapé.",
      "- O botão de ligar só deve existir se houver telefone informado acima.",
      "- Não adicione formulário que colete dados pessoais sem necessidade.",
    ]),
  ];

  if (demoUrl) {
    parts.push(
      "## Referência de conteúdo",
      `- Esta página tem exatamente o conteúdo aprovado: ${demoUrl}`,
      "  Use como referência de texto e estrutura. Pode melhorar o visual, mas não acrescente",
      "  nenhuma informação que não esteja lá.",
      "",
    );
  }

  parts.push(
    "## Aviso obrigatório",
    "- Esta página é uma DEMONSTRAÇÃO NÃO OFICIAL, criada para apresentar uma possibilidade de site",
    "  a um negócio que ainda não contratou. Mantenha um aviso visível de \"Demonstração não oficial\"",
    "  e deixe claro no rodapé que ela não é o site oficial do estabelecimento.",
  );

  return parts.join("\n").trim().slice(0, LOVABLE_PROMPT_MAX);
}

/**
 * Assembles the Build with URL address. Parameters live in the hash fragment, as
 * Lovable documents, and the reference budget is shared by images and pages.
 */
export function buildLovableBuildUrl(params: {
  prompt: string;
  images?: string[];
  htmlRefs?: string[];
}): string {
  const prompt = params.prompt.slice(0, LOVABLE_PROMPT_MAX);
  const htmlRefs = (params.htmlRefs ?? []).filter(isSafeDemoHttpsUrl).slice(0, LOVABLE_REFERENCE_MAX);
  const images = (params.images ?? [])
    .filter(isSafeDemoHttpsUrl)
    .slice(0, Math.max(0, LOVABLE_REFERENCE_MAX - htmlRefs.length));

  const fragment = [
    `prompt=${encodeURIComponent(prompt)}`,
    ...(images.length ? [`images=${images.map(encodeURIComponent).join(",")}`] : []),
    ...(htmlRefs.length ? [`html=${htmlRefs.map(encodeURIComponent).join(",")}`] : []),
  ].join("&");

  return `${LOVABLE_BUILD_BASE}#${fragment}`;
}

/** One call for the panel: briefing plus the references that go with it. */
export function buildLovableBriefing(params: {
  content: DemoLandingContent;
  demoUrl?: string | null;
}): LovableBriefing {
  const photos = collectLovablePhotos(params.content);
  const prompt = buildLovableMasterPrompt({ ...params, photos });

  return {
    prompt,
    images: photos.map((photo) => photo.url),
    htmlRefs: params.demoUrl && isSafeDemoHttpsUrl(params.demoUrl) ? [params.demoUrl] : [],
    officialPhotoCount: photos.filter((photo) => photo.kind === "official").length,
    stockPhotoCount: photos.filter((photo) => photo.kind === "stock").length,
  };
}
