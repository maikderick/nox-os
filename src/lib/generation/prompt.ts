import type { SiteBriefV2 } from "@/lib/site-factory/brief-schema";

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
 */

export type PromptInput = {
  brief: SiteBriefV2;
  projectName: string;
  repository: { owner: string; name: string; baseBranch: string };
};

function bullet(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

export function buildGenerationPrompt(input: PromptInput): string {
  const { brief } = input;

  const lines: string[] = [
    `Você vai construir o site de "${brief.businessName.value}" no repositório ${input.repository.owner}/${input.repository.name}.`,
    "",
    "Regras não negociáveis:",
    "- Use apenas os fatos listados abaixo. Não invente serviços, horários, endereços, preços, prêmios nem depoimentos.",
    "- Se um fato não está aqui, ele não vai para o site.",
    "- Trabalhe numa branch própria e abra um pull request. Não escreva na branch padrão.",
    "",
    "Fatos confirmados:",
    bullet("Nome", brief.businessName.value),
    bullet("Setor", brief.sector.value),
    bullet("Objetivo", brief.objective.value),
    bullet("Público", brief.audience.value),
    bullet("Posicionamento", brief.positioning.value),
    bullet("Direção visual", brief.visualDirection.value),
  ];

  if (brief.desiredSections.length > 0) {
    lines.push(bullet("Seções desejadas", brief.desiredSections.join(", ")));
  }

  if (brief.services.length > 0) {
    lines.push("", "Serviços confirmados:");
    for (const service of brief.services) {
      lines.push(`- ${service.name.value}: ${service.summary.value}`);
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
    lines.push("", "Contato público confirmado:", ...contactLines);
  }

  return lines.join("\n");
}
