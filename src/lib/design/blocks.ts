import { normalizeForMatching } from "@/lib/content-integrity";
import {
  briefPublicContact, isSiteBriefV2, type SiteBrief,
} from "@/lib/site-factory/brief-schema";

/**
 * The blocks a site built only from confirmed facts can publish.
 *
 * The vocabulary is the one every marketing component library uses, minus
 * everything that cannot be filled without inventing: testimonials, pricing,
 * FAQ, statistics, logo clouds, guarantee badges. Those are not omitted for
 * taste — `content-integrity.ts` already rejects the same claims in text, and a
 * block whose only possible content is invention has no place in the taxonomy.
 */
export type BlockId =
  | "navbar" | "hero" | "differentiators" | "services" | "about"
  | "hours" | "location" | "contact" | "footer";

export const BLOCK_LABELS: Record<BlockId, string> = {
  navbar: "Navegação", hero: "Abertura", differentiators: "Diferenciais",
  services: "Serviços", about: "Sobre", hours: "Horários",
  location: "Localização", contact: "Contato", footer: "Rodapé",
};

/** Canonical order. A composition is a filter over this, never a reshuffle. */
const BLOCK_ORDER: BlockId[] = [
  "navbar", "hero", "about", "differentiators", "services", "hours",
  "location", "contact", "footer",
];

/** What an operator types in `desiredSections`, mapped onto a block. */
const SECTION_ALIASES: [BlockId, string[]][] = [
  ["hero", ["inicio", "home", "abertura", "capa", "topo"]],
  ["about", ["sobre", "quem somos", "a empresa", "historia", "apresentacao"]],
  ["differentiators", ["diferenciais", "por que", "vantagens", "destaques"]],
  ["services", ["servicos", "produtos", "o que fazemos", "especialidades", "cardapio"]],
  ["hours", ["horarios", "funcionamento", "atendimento"]],
  ["location", ["localizacao", "endereco", "onde estamos", "mapa", "como chegar"]],
  ["contact", ["contato", "fale conosco", "orcamento", "agendamento"]],
];

// Aliases must match at word boundaries, never as bare substrings. After
// normalization "sobremesas" contains "sobre", "homenagem" contains "home",
// and a bare `.includes()` would silently route a restaurant's dessert
// section into `about`, or a tribute section into `hero`, with the operator
// never told the section wasn't actually built. Each regex is compiled once
// here, at module load, rather than per lookup inside the matching loop.
const WORD_BOUNDARY = String.raw`\b`;
const SECTION_ALIAS_MATCHERS: [BlockId, RegExp[]][] = SECTION_ALIASES.map(
  ([block, aliases]) => [
    block,
    aliases.map((alias) => new RegExp(`${WORD_BOUNDARY}${alias}${WORD_BOUNDARY}`)),
  ],
);

export function resolveComposition(brief: SiteBrief): { blocks: BlockId[]; unmapped: string[] } {
  const contact = briefPublicContact(brief);

  // A block is available only when the fact behind it was confirmed. This is
  // the gate, and it is the only thing that decides `blocks` below:
  // `desiredSections` never narrows or opens it — it only feeds the
  // `unmapped` report. Narrowing was deliberately not implemented: it would
  // let a brief that lists fewer sections silently drop a fact-backed block
  // (e.g. `hours`) that the operator never asked to remove. Whether a brief
  // should be able to opt a confirmed block out is a product decision left
  // to the owner.
  const available = new Set<BlockId>(["navbar", "hero", "footer"]);

  // `about` used to be unconditional, filled with the brief's `objective` and
  // `audience`. Those are notes about the job, not copy for a visitor, so the
  // block now stands on one fact of its own: the presentation text. Without it
  // there is nothing to say under "Sobre", and a section with nothing to say
  // gets no placeholder.
  if (isSiteBriefV2(brief) && brief.about) available.add("about");

  if (brief.differentiators.length > 0) available.add("differentiators");
  if (isSiteBriefV2(brief) && brief.services.length > 0) available.add("services");
  if (contact.openingHours) available.add("hours");
  if (contact.address) available.add("location");
  // A channel someone can send a message down. A confirmed address is not one:
  // it opens `location`, which owns and publishes it. Counting the address here
  // too would let an address-only brief that asks for "Contato" pass the
  // `unmapped` report — telling the operator a contact section was built when
  // there is no channel to put in it.
  if (contact.phone || contact.whatsapp || contact.email ||
      contact.socialLinks.length > 0) {
    available.add("contact");
  }

  const unmapped: string[] = [];
  for (const section of brief.desiredSections) {
    const normalized = normalizeForMatching(section);
    const match = SECTION_ALIAS_MATCHERS.find(([, regexes]) =>
      regexes.some((regex) => regex.test(normalized)),
    );
    // A requested section that maps to nothing, or to a block no confirmed
    // fact supports, is reported. Dropping it silently would let an operator
    // believe a section was built when it never could be.
    if (!match || !available.has(match[0])) unmapped.push(section);
  }

  return { blocks: BLOCK_ORDER.filter((block) => available.has(block)), unmapped };
}
