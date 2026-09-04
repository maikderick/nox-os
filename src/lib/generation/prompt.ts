import { resolveArtDirection } from "@/lib/design/art-direction";
import { toDesignMarkdown } from "@/lib/design/design-md";
import type { SiteBriefV2 } from "@/lib/site-factory/brief-schema";
import { publicBusinessName } from "@/lib/site-factory/display-name";

/**
 * The instruction the agent receives, built only from confirmed facts.
 *
 * Two properties, and both are the point rather than style:
 *
 * **Nothing here is invented.** Every value comes from a `confirmedFact` in the
 * brief — something a person read and confirmed. The factory exists so that a
 * site says only what the business actually said, and a prompt that filled the
 * gaps with plausible copy would put the invention one layer further away from
 * anyone who could catch it.
 *
 * **Nothing here is a value from outside.** No provider response, no fetched
 * page, no operator free-text field reaches this string. An agent follows
 * instructions it finds in its input, so the input is assembled from a schema
 * whose every leaf was validated, and never concatenated from something that
 * arrived over a socket.
 *
 * **Nothing here is a note to the operator.** The brief keeps two fields that
 * describe the *job* rather than the business — `objective` and `audience` —
 * and this is the third path onto a client's page, next to the exported
 * snapshot and the renderer. Neither field may appear below, with or without a
 * label: an agent told to use only the facts it is given will happily set them
 * as copy. The presentation text (`about`, falling back to `positioning`) is
 * what a visitor is meant to read, and it is what the agent receives.
 *
 * The prompt has two halves now, `# DESIGN.md` and `# BRIEFING`, and the art
 * direction that fills the first does not weaken either guarantee. It is not
 * invented: `resolveArtDirection` is a pure function over a static catalogue
 * (`src/lib/design/catalog.ts`), so the direction is chosen, not generated —
 * the same category always resolves to one of a fixed, reviewed set of looks.
 * And it is not a value from outside: its only inputs are `brief.sector.value`
 * (itself a confirmed fact) and `seed` (the project's own id, not anything a
 * provider returned or an operator typed into a free-text field). The
 * operator's `visualDirection` free text still reaches the prompt — as a
 * bullet inside `# BRIEFING`, labelled a refinement of the resolved direction,
 * never as something that can swap a token.
 */

export type PromptInput = {
  brief: SiteBriefV2;
  projectName: string;
  /** `SiteProject.id`. Fixes the direction, so the prompt is reproducible. */
  seed: string;
  repository: { owner: string; name: string; baseBranch: string };
};

function bullet(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

export function buildGenerationPrompt(input: PromptInput): string {
  const { brief } = input;
  const direction = resolveArtDirection({ sector: brief.sector.value, seed: input.seed });

  // Read through the same helper the renderer, the snapshot and the public
  // page's `<title>` use, so the site the agent writes is not called something
  // else from the preview the operator approved.
  const businessName = publicBusinessName(brief);

  const facts: string[] = [
    `Você vai construir o site de "${businessName}" no repositório ${input.repository.owner}/${input.repository.name}.`,
    "",
    "Regras não negociáveis:",
    "- Use apenas os fatos listados abaixo. Não invente serviços, horários, endereços, preços, prêmios nem depoimentos.",
    "- Se um fato não está aqui, ele não vai para o site.",
    "- Siga o DESIGN.md acima à risca. Ele é a direção de arte deste site.",
    "- Trabalhe numa branch própria e abra um pull request. Não escreva na branch padrão.",
    "",
    "Fatos confirmados:",
    bullet("Nome", businessName),
    bullet("Setor", brief.sector.value),
    // `objective` and `audience` used to sit here, under "use only the facts
    // listed below" — which is how a client's site came to tell its own
    // visitors "nicho voltado a restaurante japonês". They are answers about
    // the job; this block carries only text written for a visitor to read.
    bullet("Apresentação", (brief.about ?? brief.positioning).value),
    bullet("Posicionamento", brief.positioning.value),
  ];

  // The operator's own visual note is a confirmed fact and a refinement — it
  // steers *within* the resolved direction and never replaces a token.
  facts.push(
    "",
    "Refinamento do operador, a ser aplicado dentro da direção acima, sem trocar nenhum token:",
    `- ${brief.visualDirection.value}`,
  );

  if (brief.desiredSections.length > 0) {
    facts.push(bullet("Seções desejadas", brief.desiredSections.join(", ")));
  }

  if (brief.services.length > 0) {
    facts.push("", "Serviços confirmados:");
    for (const service of brief.services) {
      facts.push(`- ${service.name.value}: ${service.summary.value}`);
    }
  }

  const contact = brief.publicContact;
  const contactLines: string[] = [];
  if (contact.phone) contactLines.push(bullet("Telefone", contact.phone.value));
  if (contact.whatsapp) contactLines.push(bullet("WhatsApp", contact.whatsapp.value));
  if (contact.email) contactLines.push(bullet("E-mail", contact.email.value));
  if (contact.address) {
    const address = contact.address.value;
    // Assembled field by field rather than interpolated as an object: the fact
    // is structured, and a stringified object in a prompt is how a schema
    // change silently becomes "[object Object]" on a client's site.
    const parts = [
      [address.street, address.number].filter(Boolean).join(", "),
      address.neighborhood,
      `${address.city}/${address.state}`,
    ].filter((part): part is string => Boolean(part));
    contactLines.push(bullet("Endereço", parts.join(" — ")));
  }
  if (contactLines.length > 0) {
    facts.push("", "Contato público confirmado:", ...contactLines);
  }

  return [`# DESIGN.md`, ``, toDesignMarkdown(direction), ``, `# BRIEFING`, ``, ...facts].join("\n");
}
