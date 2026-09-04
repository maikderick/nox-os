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
  isSiteBriefV2,
  type BriefPublicContact,
  type BriefService,
  type ConfirmedFact,
  type SiteBrief,
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
  /**
   * Coordinates carried through untouched.
   *
   * Nothing in the wizard edits a latitude, but the brief may hold one and the
   * export publishes it. Rebuilding a stored brief without this dropped the
   * map pin of every project that had one. Editing the address clears it: a
   * pin for an address that changed is worse than no pin.
   */
  coordinates?: BriefPublicContact["coordinates"];
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
    coordinates: null,
  };
}

/**
 * Applies an edit to one weekly row.
 *
 * The week's confirmation is not decided here. A schedule that comes back out
 * exactly as it went in keeps the fact it arrived with, and one that changed
 * gets a new one — {@link reuseStoredProvenance} settles that by comparing
 * values, so toggling a day off and on again is not an edit.
 */
export function editOpeningHours(
  contact: ContactDraft,
  index: number,
  update: Partial<OpeningHoursDraft>,
): ContactDraft {
  return {
    ...contact,
    openingHours: contact.openingHours.map((day, position) =>
      position === index ? { ...day, ...update } : day,
    ),
  };
}

/**
 * Applies an edit to the address.
 *
 * Editing drops the confirmation and, unless the change came from a lead
 * suggestion, the lead attribution: what was checked is no longer what would
 * be published. It also drops the coordinates, which described the old
 * address and would otherwise put the map pin somewhere nobody chose.
 */
export function editAddressDraft(
  contact: ContactDraft,
  update: Partial<AddressDraft>,
): ContactDraft {
  return {
    ...contact,
    address: { ...contact.address, source: "OPERADOR", ...update, confirmedAt: null },
    coordinates: null,
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

  const address = isLeadAddressSuggestion(current.address)
    ? suggested.address
    : addressHasContent(current.address)
      ? current.address
      : suggested.address;

  return {
    ...current,
    phone: preferOperatorValue(current.phone, suggested.phone),
    whatsapp: preferOperatorValue(current.whatsapp, suggested.whatsapp),
    address,
    // A pin describes one address. When another lead's address takes over, the
    // pin goes with it — the same rule `editAddressDraft` applies when someone
    // edits the field by hand, applied here so it does not depend on the flow.
    coordinates: address === current.address ? current.coordinates : null,
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
    // Never edited here, only carried: see `ContactDraft.coordinates`.
    coordinates: contact.coordinates ?? null,
    // The weekly editor has no per-day "confirmado" control of its own — the
    // whole week is one fact, confirmed the moment the brief is built, the same
    // way `differentiators` turns a single authored field into one fact. A week
    // that came from a stored brief and did not change gets that fact back in
    // `reuseStoredProvenance`, stamp, source and original order included.
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
  /**
   * The briefing this draft was read from, when it was read from one.
   *
   * Kept whole, and only ever compared against: it is what lets the payload
   * hand back the *stored* fact for every value nobody changed, instead of a
   * fresh one carrying today's date and the operator's name. A draft the
   * wizard starts from scratch has none, so creating a project is unaffected.
   */
  stored?: SiteBrief | null;
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
    stored: null,
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

  const brief: SiteBriefV2 = {
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
  };

  // Everything above stamps the operator and the current time, because that is
  // what writing a value means. The last step hands back the stored fact for
  // every value that did not actually change.
  return { ok: true, issues: [], brief: reuseStoredProvenance(draft.stored, brief) };
}

// ---------------------------------------------------------------------------
// Um briefing gravado, de volta ao rascunho
// ---------------------------------------------------------------------------

/**
 * A stored fact as the editor holds it.
 *
 * Copied field by field, never re-stamped. `confirmedAt` records when a person
 * said a value was right; reopening the briefing is not saying it again, so an
 * editor that re-dated what it loaded would turn every visit into a fresh
 * confirmation nobody gave.
 */
function storedFact(fact: ConfirmedFact | null | undefined): DraftFact {
  if (!fact) return emptyFact();
  return { value: fact.value, source: fact.source, confirmedAt: fact.confirmedAt };
}

/**
 * A list of facts as one editable field.
 *
 * The wizard edits `differentiators` as a single text area, so the whole list
 * shares one source and one confirmation — which is how {@link buildBriefV2}
 * writes it back. One per line, which is the readable half of the field's
 * contract; the other half is that a comma also separates
 * ({@link splitList}), so an item that contains one cannot survive the trip
 * and is reported by {@link briefDraftLosses} before anything is saved.
 */
function storedList(facts: ConfirmedFact[]): DraftFact {
  const first = facts[0];
  if (!first) return emptyFact();
  return {
    value: facts.map((fact) => fact.value).join("\n"),
    source: first.source,
    confirmedAt: first.confirmedAt,
  };
}

function storedServiceDraft(service: BriefService, index: number): ServiceDraft {
  return {
    key: `brief-service-${index}`,
    id: service.id,
    // The id is what the service is published at. It arrived fixed and stays
    // fixed: renaming a service in the editor must not move a live URL.
    idPinned: true,
    name: service.name.value,
    summary: service.summary.value,
    body: service.body.map((paragraph) => paragraph.value).join("\n"),
    price: service.price?.value ?? "",
    featured: service.featured,
    relatedIds: [...service.relatedIds],
    confirmedAt: service.name.confirmedAt,
  };
}

/**
 * A v1 service, which is a name and nothing else.
 *
 * It is carried over rather than dropped, with an empty summary and body —
 * which the draft validation then refuses to send. That refusal is the point:
 * the operator sees the names the old briefing had and is asked to describe
 * them, instead of finding the list silently emptied.
 */
function legacyServiceDraft(fact: ConfirmedFact, index: number): ServiceDraft {
  return {
    key: `brief-service-${index}`,
    id: slugifyServiceId(fact.value),
    idPinned: true,
    name: fact.value,
    summary: "",
    body: "",
    price: "",
    featured: false,
    relatedIds: [],
    confirmedAt: fact.confirmedAt,
  };
}

function storedContactDraft(contact: BriefPublicContact): ContactDraft {
  const empty = emptyContactDraft();
  const address = contact.address;
  const openingHours = contact.openingHours;

  return {
    phone: storedFact(contact.phone),
    whatsapp: storedFact(contact.whatsapp),
    email: storedFact(contact.email),
    address: address
      ? {
          street: address.value.street,
          number: address.value.number ?? "",
          complement: address.value.complement ?? "",
          neighborhood: address.value.neighborhood ?? "",
          city: address.value.city,
          state: address.value.state,
          postalCode: address.value.postalCode ?? "",
          country: address.value.country,
          source: address.source,
          confirmedAt: address.confirmedAt,
        }
      : empty.address,
    // Seven rows always exist; a stored day fills its own. A brief that names
    // the same day twice — a split shift, which the schema allows and this
    // editor cannot express — keeps the first range and reports the rest
    // through `briefDraftLosses`, rather than dropping one in silence.
    openingHours: empty.openingHours.map((day) => {
      const stored = openingHours?.value.find((entry) => entry.dayOfWeek === day.dayOfWeek);
      return stored
        ? { dayOfWeek: day.dayOfWeek, isOpen: true, opens: stored.opens, closes: stored.closes }
        : day;
    }),
    coordinates: contact.coordinates,
    socialLinks: contact.socialLinks.map((link, index) => ({
      key: `brief-social-${index}`,
      platform: link.value.platform,
      url: link.value.url,
      label: link.value.label ?? "",
      source: link.source,
      confirmedAt: link.confirmedAt,
    })),
  };
}

/**
 * A stored briefing, back in the form that produced it.
 *
 * The exact inverse of {@link buildBriefV2} for everything the wizard can
 * express, so an operator opens an existing project, changes one sentence and
 * saves without any other fact silently changing underneath them. Two rules
 * hold it together: nothing is re-stamped, and nothing the editor cannot show
 * is invented — a missing field becomes an empty draft the operator has to
 * fill, not a plausible default.
 *
 * A v1 briefing loads too. It has no presentation text, no public contact and
 * no describable services, so those arrive empty and the draft validation asks
 * for them; saving writes a v2, which is the only migration path there is.
 */
export function briefToDraft(brief: SiteBrief): BriefDraft {
  const v2 = isSiteBriefV2(brief) ? brief : null;

  return {
    businessName: storedFact(brief.businessName),
    sector: storedFact(brief.sector),
    city: storedFact(brief.city),
    about: storedFact(v2?.about),
    objective: storedFact(brief.objective),
    audience: storedFact(brief.audience),
    positioning: storedFact(brief.positioning),
    visualDirection: storedFact(brief.visualDirection),
    notes: storedFact(brief.notes),
    metaDescription: storedFact(v2?.metaDescription),
    differentiators: storedList(brief.differentiators),
    // One per line: a section name is free text up to 80 characters and may
    // hold a comma, which the comma-separated form would split in two.
    desiredSections: brief.desiredSections.join("\n"),
    // Narrowed on `brief` rather than on `v2`: a v1 service is a bare fact and
    // a v2 service is a whole record, and only the predicate tells them apart.
    services: isSiteBriefV2(brief)
      ? brief.services.map(storedServiceDraft)
      : brief.services.map(legacyServiceDraft),
    contact: isSiteBriefV2(brief) ? storedContactDraft(brief.publicContact) : emptyContactDraft(),
    stored: brief,
  };
}

/**
 * What this editor cannot carry back out of a stored briefing.
 *
 * The draft model is the wizard's, and the schema is wider than the wizard: a
 * day may hold two ranges, a list item may contain the character that
 * separates the list, and each service fact may carry its own source. Loading
 * such a briefing and saving it would quietly normalise the parts the form
 * cannot show, so they are reported instead — the operator decides whether to
 * save, knowing what saving costs.
 */
export function briefDraftLosses(brief: SiteBrief): string[] {
  const losses: string[] = [];

  // Both lists are edited as one text box each, where a comma and a line break
  // both mean "next item". An item that already contains a comma comes back as
  // two, so the operator is told before saving rather than after.
  for (const fact of brief.differentiators) {
    if (!fact.value.includes(",")) continue;
    losses.push(
      `O diferencial “${fact.value}” tem vírgula, e o campo separa os diferenciais por vírgula. Salvar vai dividi-lo em dois: reescreva-o sem vírgula para mantê-lo inteiro.`,
    );
  }
  for (const section of brief.desiredSections) {
    if (!section.includes(",")) continue;
    losses.push(
      `A seção “${section}” tem vírgula, e o campo separa as seções por vírgula. Salvar vai dividi-la em duas.`,
    );
  }

  if (!isSiteBriefV2(brief)) return losses;

  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const day of brief.publicContact.openingHours?.value ?? []) {
    if (seen.has(day.dayOfWeek)) repeated.add(day.dayOfWeek);
    seen.add(day.dayOfWeek);
  }
  for (const day of BRIEF_DAYS) {
    if (!repeated.has(day)) continue;
    losses.push(
      `${OPENING_HOURS_DAY_LABELS[day]}: o briefing guarda mais de um intervalo neste dia. O editor mostra apenas o primeiro, e salvar descarta os demais.`,
    );
  }

  // A body paragraph is one line in the editor, and `serviceBodyParagraphs`
  // splits on every line break. One stored with a break inside comes back as
  // two paragraphs — two new facts, since neither value matches what was
  // stored — so it is named here instead of discovered afterwards.
  for (const service of brief.services) {
    const split = service.body.filter((paragraph) => /\r?\n/.test(paragraph.value));
    if (split.length === 0) continue;
    losses.push(
      split.length === 1
        ? `O serviço “${service.name.value}” tem um parágrafo com quebra de linha dentro. O editor guarda um parágrafo por linha, então salvar vai dividi-lo em dois.`
        : `O serviço “${service.name.value}” tem ${split.length} parágrafos com quebra de linha dentro. O editor guarda um parágrafo por linha, então salvar vai dividi-los.`,
    );
  }

  return losses;
}

// ---------------------------------------------------------------------------
// Proveniência: reuso por valor
// ---------------------------------------------------------------------------

/**
 * Structural equality for the small JSON values a brief fact carries.
 *
 * Written out rather than compared through `JSON.stringify`, because a stored
 * brief comes back from `JSON.parse` and its keys need not be in the order
 * this module writes them.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((item, i) => sameJsonValue(item, right[i]));
  }
  if (typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => key in b && sameJsonValue(a[key], b[key]));
  }
  return false;
}

/** Anything the schema stores as a value with its own source and moment. */
type StoredFactLike = { value: unknown; source: BriefFactSource; confirmedAt: string };

/** The stored fact when the value is untouched, the new one when it is not. */
function reuseFact<T extends StoredFactLike>(
  stored: T | null | undefined,
  built: T | null,
): T | null {
  if (!built || !stored) return built;
  return sameJsonValue(stored.value, built.value) ? stored : built;
}

function reuseRequired<T extends StoredFactLike>(stored: T | null | undefined, built: T): T {
  return stored && sameJsonValue(stored.value, built.value) ? stored : built;
}

/**
 * Matches produced facts against stored ones by value, each stored fact
 * claimable once.
 *
 * Position cannot be the key: reordering a list, or deleting the first item,
 * would hand every remaining item the wrong provenance. Value can, because
 * value is exactly what "this did not change" means here.
 */
function factPool<T extends StoredFactLike>(stored: readonly T[]): (built: T) => T {
  const remaining = [...stored];
  return (built) => {
    const index = remaining.findIndex((fact) => sameJsonValue(fact.value, built.value));
    if (index === -1) return built;
    return remaining.splice(index, 1)[0]!;
  };
}

/**
 * The stored week when the same ranges come back, in whatever order.
 *
 * The editor holds seven rows and writes them out in week order, so a briefing
 * that stored Saturday before Monday would come back reordered: same schedule,
 * different JSON, different facts hash — a "tampered briefing" for a save that
 * changed nothing. Same set, same fact, original order.
 */
function reuseOpeningHours<T extends { value: readonly unknown[]; source: BriefFactSource; confirmedAt: string }>(
  stored: T | null | undefined,
  built: T | null,
): T | null {
  if (!built || !stored || stored.value.length !== built.value.length) return built;
  const remaining = [...stored.value];
  for (const range of built.value) {
    const index = remaining.findIndex((entry) => sameJsonValue(entry, range));
    if (index === -1) return built;
    remaining.splice(index, 1);
  }
  return stored;
}

/**
 * Hands back the stored fact for every value nobody changed.
 *
 * `confirmedAt` answers "when did a person say this was right", and `source`
 * answers "who". Rebuilding a briefing from a form stamps both afresh on every
 * field, which is correct for what was typed and a lie for the twenty fields
 * that were merely displayed — it would relabel a phone the client confirmed
 * as something the operator wrote today, and change the facts hash of a save
 * that changed nothing.
 *
 * So provenance follows the value: identical value, identical fact, verbatim;
 * changed or new value, a fresh fact, and only there. Lists match by value
 * rather than by position, and services by their stable id.
 *
 * A v1 briefing lends what it has — the common fields and its service names —
 * which is why migrating one only re-dates the parts it never carried.
 */
export function reuseStoredProvenance(
  stored: SiteBrief | null | undefined,
  built: SiteBriefV2,
): SiteBriefV2 {
  if (!stored) return built;

  const v2 = isSiteBriefV2(stored) ? stored : null;
  const contact = v2?.publicContact;
  const differentiator = factPool(stored.differentiators);
  const socialLink = factPool(contact?.socialLinks ?? []);
  const legacyServiceName = factPool(isSiteBriefV2(stored) ? [] : stored.services);
  const storedServices = new Map((v2?.services ?? []).map((service) => [service.id, service]));

  return {
    ...built,
    businessName: reuseRequired(stored.businessName, built.businessName),
    sector: reuseRequired(stored.sector, built.sector),
    city: reuseFact(stored.city, built.city),
    about: reuseFact(v2?.about, built.about ?? null),
    objective: reuseRequired(stored.objective, built.objective),
    audience: reuseRequired(stored.audience, built.audience),
    positioning: reuseRequired(stored.positioning, built.positioning),
    visualDirection: reuseRequired(stored.visualDirection, built.visualDirection),
    notes: reuseFact(stored.notes, built.notes),
    metaDescription: reuseFact(v2?.metaDescription, built.metaDescription),
    differentiators: built.differentiators.map(differentiator),
    services: built.services.map((service) => {
      const previous = storedServices.get(service.id);
      // No service with this id was stored: it is new, or it was renamed into
      // existence. Only a v1 name can still recognise it, by its text.
      if (!previous) return { ...service, name: legacyServiceName(service.name) };
      const paragraph = factPool(previous.body);
      return {
        ...service,
        name: reuseRequired(previous.name, service.name),
        summary: reuseRequired(previous.summary, service.summary),
        price: reuseFact(previous.price, service.price),
        body: service.body.map(paragraph),
      };
    }),
    publicContact: {
      ...built.publicContact,
      phone: reuseFact(contact?.phone, built.publicContact.phone),
      whatsapp: reuseFact(contact?.whatsapp, built.publicContact.whatsapp),
      email: reuseFact(contact?.email, built.publicContact.email),
      address: reuseFact(contact?.address, built.publicContact.address),
      coordinates: reuseFact(contact?.coordinates, built.publicContact.coordinates),
      openingHours: reuseOpeningHours(contact?.openingHours, built.publicContact.openingHours),
      socialLinks: built.publicContact.socialLinks.map(socialLink),
    },
  };
}
