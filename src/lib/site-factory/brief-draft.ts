/**
 * The editable side of a v2 site brief.
 *
 * The wizard collects text that is *not yet* a confirmed fact: a phone number
 * copied from a lead card is a candidate until someone says "this is right".
 * The schema has no way to express that difference — every fact it accepts is
 * already confirmed — so the in-between state lives here, together with the one
 * function that turns a draft into a payload.
 *
 * The rule the whole module exists to enforce: a value reaches the payload only
 * when it carries a confirmation timestamp. Filling a field is not confirming
 * it, and a lead record confirms nothing at all.
 */

import { findClaimRisks } from "@/lib/content-integrity";
import { isMobilePhone, normalizePhoneE164 } from "@/lib/phone";

import { displayBusinessName } from "./display-name";

import {
  BRIEF_DAYS,
  BRIEF_FACT_SOURCES,
  BRIEF_SOCIAL_PLATFORMS,
  type BriefPublicContact,
  type BriefService,
  type ConfirmedFact,
  type SiteBriefV2,
} from "./brief-schema";

export type BriefFactSource = (typeof BRIEF_FACT_SOURCES)[number];
export type BriefSocialPlatform = (typeof BRIEF_SOCIAL_PLATFORMS)[number];
export type BriefDayOfWeek = (typeof BRIEF_DAYS)[number];

/** Something the operator has to fix before the brief can be sent. */
export type DraftIssue = { field: string; message: string };

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Fatos em edição
// ---------------------------------------------------------------------------

/**
 * A value being edited, plus the moment it was confirmed.
 *
 * `confirmedAt` doubles as the confirmation flag: there is no way to have a
 * confirmed fact without recording *when* it was confirmed, and no way to send
 * one that was never confirmed.
 */
export type DraftFact = {
  value: string;
  source: BriefFactSource;
  confirmedAt: string | null;
};

export function emptyFact(): DraftFact {
  return { value: "", source: "OPERADOR", confirmedAt: null };
}

/** Text the operator wrote. Writing it is confirming it. */
export function authoredFact(value: string, at: string = nowIso()): DraftFact {
  return { value, source: "OPERADOR", confirmedAt: value.trim() ? at : null };
}

/**
 * Text typed into a field that carries its own "confirmado" control.
 * Editing always drops the confirmation, so a confirmed value can never be
 * silently replaced by a different one.
 */
export function typedFact(value: string): DraftFact {
  return { value, source: "OPERADOR", confirmedAt: null };
}

/** A lead suggestion copied into a field that still needs confirming. */
export function suggestedFact(value: string): DraftFact {
  return { value, source: "LEAD", confirmedAt: null };
}

/** A lead suggestion the operator accepted outright. */
export function acceptedFact(value: string, at: string = nowIso()): DraftFact {
  return { value, source: "LEAD", confirmedAt: at };
}

export function setFactConfirmed(
  fact: DraftFact,
  confirmed: boolean,
  at: string = nowIso(),
): DraftFact {
  return { ...fact, confirmedAt: confirmed ? at : null };
}

export function isFactConfirmed(fact: { value: string; confirmedAt: string | null }): boolean {
  return Boolean(fact.confirmedAt) && fact.value.trim().length > 0;
}

/** The confirmed fact a draft field carries, or nothing at all. */
export function toConfirmedFact(fact: DraftFact): ConfirmedFact | null {
  if (!isFactConfirmed(fact)) return null;
  return { value: fact.value.trim(), source: fact.source, confirmedAt: fact.confirmedAt! };
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------

export type ServiceDraft = {
  /** React identity. Never sent: the row exists before it has a usable id. */
  key: string;
  id: string;
  /**
   * True once the id stopped following the name. The id is seeded from the
   * first name a service is given and frozen from then on, because a rename
   * must not move a URL that may already be published.
   */
  idPinned: boolean;
  name: string;
  summary: string;
  /** One paragraph per line. Split on the way out. */
  body: string;
  /** Optional, as the business states it. Empty means "not shown". */
  price: string;
  featured: boolean;
  relatedIds: string[];
  confirmedAt: string;
};

const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The id a name would produce. Accents dropped, everything else hyphenated. */
export function slugifyServiceId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/**
 * What an id field accepts while it is being typed.
 *
 * Trailing hyphens survive here — the operator is mid-word — and are reported
 * by {@link validateServices} instead of being eaten under the cursor.
 */
export function normalizeServiceIdInput(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 64);
}

export function createServiceDraft(key: string, at: string = nowIso()): ServiceDraft {
  return {
    key,
    id: "",
    idPinned: false,
    name: "",
    summary: "",
    body: "",
    price: "",
    featured: false,
    relatedIds: [],
    confirmedAt: at,
  };
}

/**
 * Renames a service.
 *
 * While the id is still following the name it is re-derived, so the operator
 * watches the slug take shape. Once pinned — the moment the name field is left,
 * or the id is edited by hand — a rename touches the name only.
 */
export function renameServiceDraft(
  service: ServiceDraft,
  name: string,
  at: string = nowIso(),
): ServiceDraft {
  return {
    ...service,
    name,
    id: service.idPinned ? service.id : slugifyServiceId(name),
    confirmedAt: at,
  };
}

/** Freezes the id against later renames. */
export function pinServiceId(service: ServiceDraft): ServiceDraft {
  if (service.idPinned) return service;
  return { ...service, idPinned: true, id: service.id || slugifyServiceId(service.name) };
}

export function setServiceId(service: ServiceDraft, id: string): ServiceDraft {
  return { ...service, id: normalizeServiceIdInput(id), idPinned: true };
}

/** Body text as the paragraphs the brief stores. */
export function serviceBodyParagraphs(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function validateServices(services: ServiceDraft[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const seen = new Map<string, number>();

  services.forEach((service, index) => {
    const field = `services.${index}`;
    const id = service.id.trim();
    const name = service.name.trim();
    const summary = service.summary.trim();
    const paragraphs = serviceBodyParagraphs(service.body);

    if (!name) {
      issues.push({ field: `${field}.name`, message: `Serviço ${index + 1}: informe o nome.` });
    }
    if (!summary) {
      issues.push({
        field: `${field}.summary`,
        message: `Serviço ${index + 1}: informe o resumo. Um serviço só com nome não gera página.`,
      });
    } else if (summary.length > 320) {
      issues.push({
        field: `${field}.summary`,
        message: `Serviço ${index + 1}: o resumo tem no máximo 320 caracteres.`,
      });
    }
    if (service.price.trim().length > 40) {
      issues.push({
        field: `${field}.price`,
        message: `Serviço ${index + 1}: o preço tem no máximo 40 caracteres.`,
      });
    }
    if (paragraphs.length === 0) {
      issues.push({
        field: `${field}.body`,
        message: `Serviço ${index + 1}: escreva ao menos um parágrafo de conteúdo.`,
      });
    } else if (paragraphs.length > 12) {
      issues.push({
        field: `${field}.body`,
        message: `Serviço ${index + 1}: no máximo 12 parágrafos.`,
      });
    }

    if (!id) {
      issues.push({
        field: `${field}.id`,
        message: `Serviço ${index + 1}: informe um identificador.`,
      });
    } else if (!SERVICE_ID_PATTERN.test(id)) {
      issues.push({
        field: `${field}.id`,
        message: `Serviço ${index + 1}: o identificador aceita apenas minúsculas, números e hífen simples.`,
      });
    } else if (seen.has(id)) {
      issues.push({
        field: `${field}.id`,
        message: `Serviço ${index + 1}: o identificador "${id}" já é usado pelo serviço ${
          seen.get(id)! + 1
        }.`,
      });
    } else {
      seen.set(id, index);
    }
  });

  const ids = new Set(services.map((service) => service.id.trim()).filter(Boolean));
  services.forEach((service, index) => {
    for (const related of service.relatedIds) {
      if (related === service.id.trim()) {
        issues.push({
          field: `services.${index}.relatedIds`,
          message: `Serviço ${index + 1}: um serviço não se relaciona consigo mesmo.`,
        });
      } else if (!ids.has(related)) {
        issues.push({
          field: `services.${index}.relatedIds`,
          message: `Serviço ${index + 1}: o relacionado "${related}" não existe.`,
        });
      }
    }
  });

  if (services.length > 40) {
    issues.push({ field: "services", message: "No máximo 40 serviços por briefing." });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Contato público
// ---------------------------------------------------------------------------

export type AddressDraft = {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  source: BriefFactSource;
  confirmedAt: string | null;
};

export type SocialLinkDraft = {
  key: string;
  platform: BriefSocialPlatform;
  url: string;
  label: string;
  source: BriefFactSource;
  confirmedAt: string | null;
};

/** The parts of a social link that are a claim about the client. */
const SOCIAL_FACT_FIELDS = ["platform", "url", "label"] as const;

/**
 * Applies an edit to a social link, resetting its confirmation when the edit
 * changes what would be published.
 *
 * All three fields matter. A `label` is what a visitor reads next to the link,
 * and a `platform` decides which network the site says the profile belongs to —
 * neither is presentation. Changing any of them means what was confirmed is no
 * longer what would go out, so the fact reverts to the operator and has to be
 * confirmed again.
 *
 * Centralised on purpose: doing this at each call site is how `label` ended up
 * resetting nothing and `platform` ended up keeping `source: "LEAD"` after the
 * operator had changed it.
 */
export function editSocialLinkDraft(
  link: SocialLinkDraft,
  update: Partial<SocialLinkDraft>,
): SocialLinkDraft {
  const next = { ...link, ...update };

  const changed = SOCIAL_FACT_FIELDS.some(
    (field) => field in update && update[field] !== link[field],
  );
  if (!changed) return next;

  // Re-selecting the same value is not an edit, so a confirmation survives it.
  return { ...next, source: "OPERADOR", confirmedAt: null };
}

/**
 * One weekly row in the wizard's opening-hours editor.
 *
 * All seven days exist from the start — there is no "add a day" step — so a
 * row is closed rather than absent. `opens`/`closes` stay empty until the
 * operator picks a time; nothing plausible is pre-filled here.
 */
export type OpeningHoursDraft = {
  dayOfWeek: BriefDayOfWeek;
  isOpen: boolean;
  opens: string;
  closes: string;
};

// Mirrors `clockTimeSchema`'s regex in brief-schema.ts. Not exported from there,
// so it is re-declared here to keep the draft validation in lockstep with what
// the server actually enforces.
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const BRIEF_DAY_SET: ReadonlySet<string> = new Set(BRIEF_DAYS);

/** Portuguese day labels, shared by the weekly editor and its validation messages. */
export const OPENING_HOURS_DAY_LABELS: Record<BriefDayOfWeek, string> = {
  SEGUNDA: "Segunda-feira",
  TERCA: "Terça-feira",
  QUARTA: "Quarta-feira",
  QUINTA: "Quinta-feira",
  SEXTA: "Sexta-feira",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

export function emptyOpeningHoursDraft(): OpeningHoursDraft[] {
  return BRIEF_DAYS.map((dayOfWeek) => ({ dayOfWeek, isOpen: false, opens: "", closes: "" }));
}

export type ContactDraft = {
  phone: DraftFact;
  whatsapp: DraftFact;
  email: DraftFact;
  address: AddressDraft;
  openingHours: OpeningHoursDraft[];
  socialLinks: SocialLinkDraft[];
};

export function emptyAddressDraft(): AddressDraft {
  return {
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    postalCode: "",
    country: "Brasil",
    source: "OPERADOR",
    confirmedAt: null,
  };
}

export function emptyContactDraft(): ContactDraft {
  return {
    phone: emptyFact(),
    whatsapp: emptyFact(),
    email: emptyFact(),
    address: emptyAddressDraft(),
    openingHours: emptyOpeningHoursDraft(),
    socialLinks: [],
  };
}

export function createSocialLinkDraft(key: string): SocialLinkDraft {
  return { key, platform: "INSTAGRAM", url: "", label: "", source: "OPERADOR", confirmedAt: null };
}

export function addressHasContent(address: AddressDraft): boolean {
  return Boolean(
    address.street.trim() ||
      address.number.trim() ||
      address.complement.trim() ||
      address.neighborhood.trim() ||
      address.city.trim() ||
      address.state.trim() ||
      address.postalCode.trim(),
  );
}

const SOCIAL_HOSTS: Array<[RegExp, BriefSocialPlatform]> = [
  [/(^|\.)instagram\.com$/i, "INSTAGRAM"],
  [/(^|\.)(facebook|fb)\.com$/i, "FACEBOOK"],
  [/(^|\.)linkedin\.com$/i, "LINKEDIN"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "YOUTUBE"],
  [/(^|\.)tiktok\.com$/i, "TIKTOK"],
  [/(^|\.)(twitter|x)\.com$/i, "X"],
];

/** The platform a URL points at, when it is one the brief knows about. */
export function guessSocialPlatform(url: string): BriefSocialPlatform | null {
  try {
    const host = new URL(url.trim()).hostname;
    for (const [pattern, platform] of SOCIAL_HOSTS) {
      if (pattern.test(host)) return platform;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidatos vindos do lead
// ---------------------------------------------------------------------------

/**
 * The lead fields that can seed a contact draft.
 *
 * Structural, not the `Business` row: the draft layer must not depend on the
 * database shape, and nothing here can carry a value that is not already a
 * contact candidate.
 */
export type LeadContactCandidate = {
  name?: string;
  phoneE164?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  socialLinks?: string[];
};

/** The handle a social URL ends in, as a label a visitor would recognise. */
function socialHandle(url: string): string {
  try {
    const segments = new URL(url.trim()).pathname.split("/").filter(Boolean);
    const handle = segments[0] ?? "";
    return handle ? `@${handle}` : "";
  } catch {
    return "";
  }
}

/**
 * The contact draft a selected lead suggests.
 *
 * Every field comes back **unconfirmed**, carrying `source: "LEAD"`. That is
 * the whole point: the operator was skipping the contact step because it
 * started empty, and a site shipped with no phone and no address while the
 * lead card had both. Offering them as candidates costs one confirmation each;
 * leaving them out costs the client their contact block.
 *
 * What is deliberately *not* suggested:
 *
 * - Opening hours. The lead carries none, so anything here would be invented.
 * - The website. A business with its own site is filtered out upstream, so a
 *   value in that column is stale.
 * - WhatsApp for a landline. The number is offered as WhatsApp only when it is
 *   a mobile line; a landline behind a WhatsApp button is a dead end.
 */
export function leadContactDraft(
  lead: LeadContactCandidate | null | undefined,
  keyFor: (index: number) => string = (index) => `lead-social-${index}`,
): ContactDraft {
  const draft = emptyContactDraft();
  if (!lead) return draft;

  const phone = lead.phoneE164?.trim() ?? "";
  if (phone) {
    draft.phone = suggestedFact(phone);
    if (isMobilePhone(phone)) draft.whatsapp = suggestedFact(phone);
  }

  const address: Partial<AddressDraft> = {
    street: lead.address?.trim() ?? "",
    neighborhood: lead.neighborhood?.trim() ?? "",
    city: lead.city?.trim() ?? "",
    state: lead.state?.trim() ?? "",
    postalCode: lead.postalCode?.trim() ?? "",
  };
  const suggestedAddress = { ...draft.address, ...address };
  // The street number is not a column on the lead; it stays for the operator.
  if (addressHasContent(suggestedAddress)) {
    draft.address = { ...suggestedAddress, source: "LEAD", confirmedAt: null };
  }

  draft.socialLinks = (lead.socialLinks ?? []).flatMap((url, index) => {
    const trimmed = url.trim();
    const platform = guessSocialPlatform(trimmed);
    // A URL on no network the brief knows about would be published under a
    // platform nobody chose, so it is dropped rather than guessed at.
    if (!platform) return [];
    return [
      {
        ...createSocialLinkDraft(keyFor(index)),
        platform,
        url: trimmed,
        label: socialHandle(trimmed),
        source: "LEAD" as const,
        confirmedAt: null,
      },
    ];
  });

  return draft;
}

/** True while a field still shows a lead's suggestion nobody has confirmed. */
export function isLeadSuggestion(fact: {
  value: string;
  source: BriefFactSource;
  confirmedAt: string | null;
}): boolean {
  return fact.source === "LEAD" && !fact.confirmedAt && fact.value.trim().length > 0;
}

/** True while an address still shows a lead's suggestion nobody has confirmed. */
export function isLeadAddressSuggestion(address: AddressDraft): boolean {
  return address.source === "LEAD" && !address.confirmedAt && addressHasContent(address);
}

/**
 * Chooses between what a field holds and what the newly picked lead suggests.
 *
 * Three states, and the middle one is the fix: a value the operator produced
 * (typed, or confirmed) always wins; an **unconfirmed suggestion from a
 * previous lead** is stale and is replaced — even by nothing, when the new
 * lead has no such datum; an empty field takes the suggestion.
 *
 * Without the middle case, picking the wrong lead and correcting it left the
 * first lead's phone and address in the draft, still labelled "sugerido pelo
 * lead — confirme". An operator who trusted that label published another
 * business's contact details.
 */
function preferOperatorValue(current: DraftFact, suggested: DraftFact): DraftFact {
  if (isLeadSuggestion(current)) return suggested;
  return current.value.trim() ? current : suggested;
}

/**
 * Lays a lead's candidates under what the operator already has.
 *
 * Opening hours and e-mail are never suggested, so they pass through
 * untouched. Social links merge by URL rather than wholesale: a single empty
 * row the operator had opened used to discard every suggestion at once.
 */
export function mergeLeadContactDraft(
  current: ContactDraft,
  suggested: ContactDraft,
): ContactDraft {
  const ownLinks = current.socialLinks.filter(
    (link) =>
      !isLeadSuggestion({ value: link.url, source: link.source, confirmedAt: link.confirmedAt }),
  );
  const takenUrls = new Set(ownLinks.map((link) => link.url.trim()).filter(Boolean));

  return {
    ...current,
    phone: preferOperatorValue(current.phone, suggested.phone),
    whatsapp: preferOperatorValue(current.whatsapp, suggested.whatsapp),
    address: isLeadAddressSuggestion(current.address)
      ? suggested.address
      : addressHasContent(current.address)
        ? current.address
        : suggested.address,
    socialLinks: [
      ...ownLinks,
      ...suggested.socialLinks.filter((link) => !takenUrls.has(link.url.trim())),
    ],
  };
}

/**
 * The whole draft after a lead is picked.
 *
 * Kept here, as a pure function, because it is the decision most likely to go
 * wrong — and the two ways it did go wrong (a name confirmed by nobody, a
 * previous lead's contact surviving the correction) are both invisible from a
 * component test. `businessName` follows exactly the rule the contact fields
 * follow: it arrives as an unconfirmed `LEAD` candidate, marked as such, and
 * reaches the payload only once someone confirms or rewrites it.
 */
export function applyLeadToDraft(
  draft: BriefDraft,
  lead: (LeadContactCandidate & { name?: string }) | null | undefined,
  keyFor?: (index: number) => string,
): BriefDraft {
  const suggestedName = lead?.name?.trim() ? displayBusinessName(lead.name.trim()) : "";

  return {
    ...draft,
    businessName: preferOperatorValue(
      draft.businessName,
      suggestedName ? suggestedFact(suggestedName) : emptyFact(),
    ),
    contact: mergeLeadContactDraft(draft.contact, leadContactDraft(lead, keyFor)),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value.trim())) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validatePublicContact(contact: ContactDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  for (const [field, label] of [
    ["phone", "Telefone"],
    ["whatsapp", "WhatsApp"],
  ] as const) {
    const fact = contact[field];
    if (!isFactConfirmed(fact)) continue;
    if (!normalizePhoneE164(fact.value)) {
      issues.push({
        field: `publicContact.${field}`,
        message: `${label}: número inválido. Use DDD + número (ex.: (85) 99999-0000) para que possa ser gravado como +55…`,
      });
    }
  }

  if (isFactConfirmed(contact.email) && !EMAIL_PATTERN.test(contact.email.value.trim())) {
    issues.push({ field: "publicContact.email", message: "E-mail: endereço inválido." });
  }

  const address = contact.address;
  if (address.confirmedAt && addressHasContent(address)) {
    for (const [field, label] of [
      ["street", "logradouro"],
      ["city", "cidade"],
      ["state", "estado"],
    ] as const) {
      if (!address[field].trim()) {
        issues.push({
          field: `publicContact.address.${field}`,
          message: `Endereço confirmado sem ${label}: preencha ou desmarque a confirmação.`,
        });
      }
    }
  }

  contact.openingHours.forEach((day, index) => {
    if (!day.isOpen) return;
    if (!BRIEF_DAY_SET.has(day.dayOfWeek)) {
      issues.push({
        field: `publicContact.openingHours.${index}`,
        message: "Dia da semana inválido.",
      });
      return;
    }
    const label = OPENING_HOURS_DAY_LABELS[day.dayOfWeek];
    if (!day.opens.trim() || !day.closes.trim()) {
      issues.push({
        field: `publicContact.openingHours.${index}`,
        message: `${label}: informe os horários de abertura e fechamento.`,
      });
      return;
    }
    // Mirrors clockTimeSchema's regex (brief-schema.ts): the draft must reject
    // the same malformed times the server would, with an inline message instead
    // of a generic error after a round trip.
    if (!CLOCK_TIME_PATTERN.test(day.opens) || !CLOCK_TIME_PATTERN.test(day.closes)) {
      issues.push({
        field: `publicContact.openingHours.${index}`,
        message: `${label}: Use o formato HH:MM.`,
      });
      return;
    }
    // Mirrors the `opens < closes` refine in the v2 schema so the operator sees
    // the same rule before submitting, not after a round trip to the server.
    if (!(day.opens < day.closes)) {
      issues.push({
        field: `publicContact.openingHours.${index}`,
        message: `${label}: o horário de abertura precisa ser anterior ao de fechamento.`,
      });
    }
  });

  const seenUrls = new Set<string>();
  contact.socialLinks.forEach((link, index) => {
    if (!link.confirmedAt) return;
    const url = link.url.trim();
    if (!url) {
      issues.push({
        field: `publicContact.socialLinks.${index}`,
        message: `Rede social ${index + 1}: confirmada sem endereço.`,
      });
      return;
    }
    if (!isHttpsUrl(url)) {
      issues.push({
        field: `publicContact.socialLinks.${index}`,
        message: `Rede social ${index + 1}: use um endereço https válido.`,
      });
      return;
    }
    if (seenUrls.has(url)) {
      issues.push({
        field: `publicContact.socialLinks.${index}`,
        message: `Rede social ${index + 1}: endereço repetido.`,
      });
    }
    seenUrls.add(url);
  });

  if (contact.socialLinks.filter((link) => link.confirmedAt).length > 12) {
    issues.push({ field: "publicContact.socialLinks", message: "No máximo 12 redes sociais." });
  }

  return issues;
}

function buildPublicContact(contact: ContactDraft): BriefPublicContact {
  const phone = toConfirmedFact(contact.phone);
  const whatsapp = toConfirmedFact(contact.whatsapp);
  const email = toConfirmedFact(contact.email);
  const address = contact.address;

  const phoneE164 = phone ? normalizePhoneE164(phone.value) : null;
  const whatsappE164 = whatsapp ? normalizePhoneE164(whatsapp.value) : null;

  return {
    phone: phone && phoneE164 ? { ...phone, value: phoneE164 } : null,
    whatsapp: whatsapp && whatsappE164 ? { ...whatsapp, value: whatsappE164 } : null,
    // Trimmed, never rewritten: the operator confirmed this exact string.
    email,
    address:
      address.confirmedAt && addressHasContent(address)
        ? {
            value: {
              street: address.street.trim(),
              number: address.number.trim() || null,
              complement: address.complement.trim() || null,
              neighborhood: address.neighborhood.trim() || null,
              city: address.city.trim(),
              state: address.state.trim(),
              postalCode: address.postalCode.trim() || null,
              country: address.country.trim() || "Brasil",
            },
            source: address.source,
            confirmedAt: address.confirmedAt,
          }
        : null,
    coordinates: null,
    // The weekly editor has no per-day "confirmado" control of its own — the
    // whole week is one fact, confirmed the moment the brief is built, the same
    // way `differentiators` turns a single authored field into one fact.
    openingHours: (() => {
      const openDays = contact.openingHours.filter((day) => day.isOpen);
      if (openDays.length === 0) return null;
      return {
        value: openDays.map((day) => ({
          dayOfWeek: day.dayOfWeek,
          opens: day.opens,
          closes: day.closes,
        })),
        source: "OPERADOR",
        confirmedAt: nowIso(),
      };
    })(),
    socialLinks: contact.socialLinks.flatMap((link) =>
      link.confirmedAt && link.url.trim()
        ? [
            {
              value: {
                platform: link.platform,
                url: link.url.trim(),
                label: link.label.trim() || null,
              },
              source: link.source,
              confirmedAt: link.confirmedAt,
            },
          ]
        : [],
    ),
  };
}

// ---------------------------------------------------------------------------
// O rascunho inteiro
// ---------------------------------------------------------------------------

export type BriefDraft = {
  businessName: DraftFact;
  sector: DraftFact;
  city: DraftFact;
  /** The business presented to its customers. The only narrative field published. */
  about: DraftFact;
  objective: DraftFact;
  audience: DraftFact;
  positioning: DraftFact;
  visualDirection: DraftFact;
  notes: DraftFact;
  metaDescription: DraftFact;
  /** Comma or newline separated. Splitting inherits this field's confirmation. */
  differentiators: DraftFact;
  /** Comma or newline separated. Plain strings, not facts. */
  desiredSections: string;
  services: ServiceDraft[];
  contact: ContactDraft;
};

export function emptyBriefDraft(): BriefDraft {
  return {
    businessName: emptyFact(),
    sector: emptyFact(),
    city: emptyFact(),
    about: emptyFact(),
    objective: emptyFact(),
    audience: emptyFact(),
    positioning: emptyFact(),
    visualDirection: emptyFact(),
    notes: emptyFact(),
    metaDescription: emptyFact(),
    differentiators: emptyFact(),
    desiredSections: "",
    services: [],
    contact: emptyContactDraft(),
  };
}

/**
 * What the wizard starts from.
 *
 * The narrative fields stay empty. They used to arrive pre-filled with
 * boilerplate that counted as confirmed by the operator the moment the form
 * mounted — nobody had written or read it, and it would reach the site as the
 * client's own positioning. A confirmation nobody made is exactly what this
 * flow exists to prevent.
 *
 * `desiredSections` is not a claim about the client — it is which pages to
 * build — so it keeps a sensible starting point.
 */
export function initialBriefDraft(): BriefDraft {
  return {
    ...emptyBriefDraft(),
    desiredSections: "Início, Sobre, Serviços, Contato",
  };
}

export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The fields a brief cannot be sent without, each with the sentence the
 * operator reads. The message is written out rather than derived from a label
 * because `about` asks for something in plain words — an operator who reads
 * "Apresentação para o cliente: confirme este campo" still does not know what
 * to write there.
 */
const REQUIRED_NARRATIVE: Array<[keyof BriefDraft, string]> = [
  ["businessName", "Nome do negócio: confirme este campo."],
  ["sector", "Setor: confirme este campo."],
  ["about", "Preencha a apresentação para o cliente."],
  ["objective", "Objetivo: confirme este campo."],
  ["audience", "Público: confirme este campo."],
  ["positioning", "Frase de destaque: confirme este campo."],
  ["visualDirection", "Direção visual: confirme este campo."],
];

export function validateNarrative(draft: BriefDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  for (const [field, message] of REQUIRED_NARRATIVE) {
    if (!isFactConfirmed(draft[field] as DraftFact)) {
      issues.push({ field: String(field), message });
    }
  }

  const sections = splitList(draft.desiredSections);
  if (sections.length === 0) {
    issues.push({ field: "desiredSections", message: "Informe ao menos uma seção desejada." });
  } else if (sections.length > 12) {
    issues.push({ field: "desiredSections", message: "No máximo 12 seções." });
  } else if (sections.some((section) => section.length > 80)) {
    issues.push({ field: "desiredSections", message: "Cada seção tem no máximo 80 caracteres." });
  }

  if (isFactConfirmed(draft.metaDescription) && draft.metaDescription.value.trim().length > 180) {
    issues.push({
      field: "metaDescription",
      message: "A meta description tem no máximo 180 caracteres.",
    });
  }

  if (isFactConfirmed(draft.differentiators) && splitList(draft.differentiators.value).length > 8) {
    issues.push({ field: "differentiators", message: "No máximo 8 diferenciais." });
  }

  return issues;
}

/**
 * Reports the unsupported claims the schema would reject.
 *
 * Same function the schema uses, so the wizard cannot drift from the server:
 * catching it here only means the operator reads the problem next to the field
 * instead of after a round trip.
 */
export function validateClaims(draft: BriefDraft): DraftIssue[] {
  // Only what would actually be sent. Text sitting in an unconfirmed field is
  // never published, so it must not block the operator either.
  const narrative = (["about", "objective", "audience", "positioning", "visualDirection", "notes"] as const)
    .filter((field) => isFactConfirmed(draft[field]))
    .map((field) => ({ field, value: draft[field].value }));

  const entries = [
    ...narrative,
    ...(isFactConfirmed(draft.differentiators)
      ? splitList(draft.differentiators.value).map((value, index) => ({
          field: `differentiators.${index}`,
          value,
        }))
      : []),
    ...draft.services.flatMap((service, index) => [
      { field: `services.${index}.name`, value: service.name },
      { field: `services.${index}.summary`, value: service.summary },
      ...serviceBodyParagraphs(service.body).map((paragraph, bodyIndex) => ({
        field: `services.${index}.body.${bodyIndex}`,
        value: paragraph,
      })),
    ]),
  ].filter((entry) => entry.value.trim().length > 0);

  return findClaimRisks(entries).map((risk) => ({
    field: risk.field,
    message: `Afirmação não sustentada em "${risk.field}": ${risk.label}. Remova ou confirme na ficha do lead.`,
  }));
}

export type BriefDraftBuild =
  | { ok: true; brief: SiteBriefV2; issues: [] }
  | { ok: false; brief: null; issues: DraftIssue[] };

/**
 * Turns a draft into the payload the API accepts.
 *
 * Every unconfirmed field is dropped on the way through — that is the whole
 * contract. A required field that was never confirmed is an error, an optional
 * one simply does not exist.
 */
export function buildBriefV2(draft: BriefDraft): BriefDraftBuild {
  const issues = [
    ...validateNarrative(draft),
    ...validateServices(draft.services),
    ...validatePublicContact(draft.contact),
    ...validateClaims(draft),
  ];
  if (issues.length > 0) return { ok: false, brief: null, issues };

  const required = (fact: DraftFact): ConfirmedFact => toConfirmedFact(fact)!;
  const differentiators = toConfirmedFact(draft.differentiators);

  const services: BriefService[] = draft.services.map((service) => ({
    id: service.id.trim(),
    name: { value: service.name.trim(), source: "OPERADOR", confirmedAt: service.confirmedAt },
    summary: {
      value: service.summary.trim(),
      source: "OPERADOR",
      confirmedAt: service.confirmedAt,
    },
    body: serviceBodyParagraphs(service.body).map((paragraph) => ({
      value: paragraph,
      source: "OPERADOR" as const,
      confirmedAt: service.confirmedAt,
    })),
    price: service.price.trim()
      ? { value: service.price.trim(), source: "OPERADOR" as const, confirmedAt: service.confirmedAt }
      : null,
    relatedIds: [...service.relatedIds],
    featured: service.featured,
  }));

  return {
    ok: true,
    issues: [],
    brief: {
      schemaVersion: 2,
      businessName: required(draft.businessName),
      sector: required(draft.sector),
      city: toConfirmedFact(draft.city),
      about: required(draft.about),
      objective: required(draft.objective),
      audience: required(draft.audience),
      positioning: required(draft.positioning),
      differentiators: differentiators
        ? splitList(differentiators.value).map((value) => ({
            value,
            source: differentiators.source,
            confirmedAt: differentiators.confirmedAt,
          }))
        : [],
      desiredSections: splitList(draft.desiredSections),
      visualDirection: required(draft.visualDirection),
      notes: toConfirmedFact(draft.notes),
      services,
      publicContact: buildPublicContact(draft.contact),
      metaDescription: toConfirmedFact(draft.metaDescription),
    },
  };
}
