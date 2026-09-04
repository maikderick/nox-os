import { ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { resolveArtDirection } from "@/lib/design/art-direction";
import { resolveComposition, type BlockId } from "@/lib/design/blocks";
import { toStyleAttribute } from "@/lib/design/tokens";
import {
  BRIEF_DAYS,
  briefPublicContact,
  isSiteBriefV2,
  type BriefService,
  type SiteBrief,
} from "@/lib/site-factory/brief-schema";

type PostalAddress = {
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  country: string;
};

function addressLines(address: PostalAddress): string[] {
  // Joined with commas and line breaks. A middle dot between fields is one of
  // the tells the anti-slop rules exist to stop.
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.neighborhood,
    `${address.city}, ${address.state}`,
    address.postalCode,
    // The schema defaults `country` to "Brasil" and the site is written in
    // pt-BR, so a domestic address printing "Brasil" reads as filler. A foreign
    // address has to name its country, and that is the only case it appears.
    address.country === "Brasil" ? null : address.country,
  ].filter((line): line is string => Boolean(line));
}

const DAY_LABELS: Record<(typeof BRIEF_DAYS)[number], string> = {
  SEGUNDA: "Segunda-feira",
  TERCA: "Terça-feira",
  QUARTA: "Quarta-feira",
  QUINTA: "Quinta-feira",
  SEXTA: "Sexta-feira",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

/**
 * The four presentation families the fourteen devices collapse into.
 *
 * Without this the directions differ only in palette and typeface — fourteen
 * skins over one layout, which is the template again. Each family changes the
 * structure of the services list, the one block long enough for structure to
 * read, and `spine` additionally rules every section container.
 */
type DeviceFamily = "leader" | "index" | "spine" | "plain";

const DEVICE_FAMILIES: Record<string, DeviceFamily> = {
  "menu-leader": "leader",
  "tabular-numeral": "index",
  "spec-table": "index",
  "tabular-index": "index",
  "bound-spine": "spine",
  "dimension-line": "spine",
};

function deviceFamily(device: string): DeviceFamily {
  return DEVICE_FAMILIES[device] ?? "plain";
}

/**
 * The single motion moment, behind the reduced-motion query.
 *
 * Opacity plus two pixels, over `--motion-max`. A direction whose moment is
 * `none` never emits this rule at all, so the budget cannot be spent twice.
 */
const HERO_ENTRANCE_CSS =
  "@media (prefers-reduced-motion: no-preference){" +
  "@keyframes site-hero-enter{from{opacity:0;transform:translateY(2px)}" +
  "to{opacity:1;transform:translateY(0)}}" +
  "[data-hero-enter]{animation:site-hero-enter var(--motion-max) ease-out both}}";

const DISPLAY_TEXT: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-display)",
  lineHeight: "var(--leading-display)",
  letterSpacing: "var(--tracking-display)",
  fontWeight: 500,
};

const HEADING_TEXT: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-heading)",
  lineHeight: "var(--leading-heading)",
  letterSpacing: "var(--tracking-heading)",
  fontWeight: 500,
};

/**
 * The service name: the third level.
 *
 * A service name set in `HEADING_TEXT` is byte-identical to the section heading
 * above it, which leaves the one block long enough to have hierarchy with none.
 * Body size in the display face at 600 sits between the 2rem section heading
 * and the 400-weight summary without adding a fifth size to the scale.
 */
const SERVICE_NAME_TEXT: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-body)",
  lineHeight: "var(--leading-body)",
  fontWeight: 600,
};

const BODY_TEXT: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-body)",
  lineHeight: "var(--leading-body)",
  letterSpacing: "var(--tracking-body)",
  fontWeight: 400,
};

const SMALL_TEXT: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-small)",
  lineHeight: "var(--leading-small)",
  letterSpacing: "var(--tracking-small)",
  fontWeight: 400,
};

const ROW: CSSProperties = {
  borderTop: "1px solid var(--line)",
  paddingBlock: "var(--space-inline)",
};

const ICON: CSSProperties = { color: "var(--ink-muted)", flexShrink: 0 };

/** A section: one ground, one measure, and the spine when the device asks. */
function SiteSection({
  id,
  ground,
  spine,
  children,
}: {
  id: string;
  ground: string;
  spine: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} style={{ background: ground, paddingBlock: "var(--space-section)" }}>
      <div className="mx-auto max-w-5xl px-6">
        <div
          style={
            spine
              ? {
                  color: "var(--ink)",
                  borderLeft: "2px solid var(--line)",
                  paddingLeft: "var(--space-inline)",
                }
              : { color: "var(--ink)" }
          }
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 style={HEADING_TEXT}>{children}</h2>;
}

/** A dimension line: a rule with a tick at each end, as on a floor plan. */
function RuleDivider({ ticks }: { ticks: boolean }) {
  if (!ticks) return <div style={{ borderTop: "1px solid var(--line)" }} />;
  return (
    <div aria-hidden="true" className="flex items-center">
      <span
        style={{ display: "inline-block", width: "1px", height: "8px", background: "var(--line)" }}
      />
      <span style={{ display: "block", flex: "1 1 auto", borderTop: "1px solid var(--line)" }} />
      <span
        style={{ display: "inline-block", width: "1px", height: "8px", background: "var(--line)" }}
      />
    </div>
  );
}

export function ProjectSite({ brief, seed }: { brief: SiteBrief; seed: string }) {
  const direction = resolveArtDirection({ sector: brief.sector.value, seed });
  const { blocks } = resolveComposition(brief);
  const contact = briefPublicContact(brief);
  const services: BriefService[] = isSiteBriefV2(brief) ? brief.services : [];
  const has = (block: BlockId) => blocks.includes(block);

  const family = deviceFamily(direction.device);
  const upper = direction.type.displayCase === "upper";
  const centred = direction.device === "facade-symmetry";
  const moves = direction.motion.moment !== "none";

  // The two dense families drop the summary to `--text-small` so the structure,
  // not the prose, carries the row. Everything else — `large-body` above all —
  // keeps it at body size.
  const summarySize =
    family === "leader" || family === "index" ? "var(--text-small)" : "var(--text-body)";

  // One ground: `--surface` and `--surface-alt` alternate down the page, over
  // the blocks actually present, so a missing block never leaves two identical
  // grounds touching.
  const contentBlocks: BlockId[] = blocks.filter(
    (block) => block !== "navbar" && block !== "footer",
  );
  const groundOf = (block: BlockId) =>
    contentBlocks.indexOf(block) % 2 === 0 ? "var(--surface)" : "var(--surface-alt)";

  const contactRows: ReactNode[] = [];
  if (contact.phone) {
    contactRows.push(
      <li key="phone" style={ROW}>
        <a
          href={`tel:${contact.phone.value}`}
          className="flex items-center gap-3"
          style={{ ...BODY_TEXT, color: "var(--ink)" }}
        >
          <Phone size={16} style={ICON} />
          <span>{contact.phone.value}</span>
        </a>
      </li>,
    );
  }
  if (contact.whatsapp) {
    contactRows.push(
      <li key="whatsapp" style={ROW}>
        <a
          href={`https://wa.me/${contact.whatsapp.value.replace(/\D/g, "")}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3"
          style={{ ...BODY_TEXT, color: "var(--ink)" }}
        >
          <MessageCircle size={16} style={ICON} />
          <span>WhatsApp</span>
        </a>
      </li>,
    );
  }
  if (contact.email) {
    contactRows.push(
      <li key="email" style={ROW}>
        <a
          href={`mailto:${contact.email.value}`}
          className="flex items-center gap-3"
          style={{ ...BODY_TEXT, color: "var(--ink)" }}
        >
          <Mail size={16} style={ICON} />
          <span className="break-all">{contact.email.value}</span>
        </a>
      </li>,
    );
  }
  for (const social of contact.socialLinks) {
    contactRows.push(
      <li key={social.value.url} style={ROW}>
        <a
          href={social.value.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3"
          style={{ ...BODY_TEXT, color: "var(--ink)" }}
        >
          <ExternalLink size={16} style={ICON} />
          <span>{social.value.label ?? social.value.platform}</span>
        </a>
      </li>,
    );
  }

  const openingHours = contact.openingHours;
  const hours = openingHours
    ? BRIEF_DAYS.flatMap((day) =>
        openingHours.value.filter((entry) => entry.dayOfWeek === day),
      )
    : [];

  const spine = family === "spine";
  const ticks = direction.device === "dimension-line";

  const serviceSummary = (service: BriefService, extra?: CSSProperties) => (
    <p style={{ ...BODY_TEXT, fontSize: summarySize, color: "var(--ink-muted)", ...extra }}>
      {service.summary.value}
    </p>
  );

  // Every paragraph of `body` is a confirmed fact in its own right, and the
  // schema requires at least one. Publishing the summary and dropping these
  // would lose facts someone took the trouble to confirm, so all four families
  // print them - in `leader` and `index` on their own full-width row, so the
  // menu and the table keep their shape.
  const serviceBody = (service: BriefService) =>
    service.body.map((paragraph, index) => (
      <p
        key={`${service.id}-${index}`}
        style={{
          ...BODY_TEXT,
          marginTop: "var(--space-inline)",
          color: "var(--ink-muted)",
          maxWidth: "62ch",
        }}
      >
        {paragraph.value}
      </p>
    ));

  function renderServices() {
    if (family === "leader") {
      // A menu: the name, a dotted leader across the gap, the summary. No card.
      return (
        <div style={{ marginTop: "var(--space-block)" }}>
          {services.map((service) => (
            <article key={service.id} style={ROW}>
              <div className="flex items-baseline gap-4">
                <h3 style={{ ...SERVICE_NAME_TEXT, flex: "0 0 auto" }}>{service.name.value}</h3>
                <span
                  aria-hidden="true"
                  style={{ flex: "1 1 2rem", borderBottom: "1px dotted var(--line)" }}
                />
                {serviceSummary(service, { flex: "0 1 34ch", textAlign: "right" })}
              </div>
              {serviceBody(service)}
            </article>
          ))}
        </div>
      );
    }

    if (family === "index") {
      // An index: two columns, ruled rows, figures that line up. No card.
      return (
        <div style={{ marginTop: "var(--space-block)", fontVariantNumeric: "tabular-nums" }}>
          {services.map((service) => (
            <article key={service.id} style={ROW}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(9rem, 18rem) 1fr",
                  gap: "var(--space-inline)",
                }}
              >
                <h3 style={SERVICE_NAME_TEXT}>{service.name.value}</h3>
                {serviceSummary(service, { maxWidth: "62ch" })}
              </div>
              {serviceBody(service)}
            </article>
          ))}
        </div>
      );
    }

    if (family === "spine") {
      // Stacked under the section spine, parted by a rule, or by a cota.
      return (
        <div style={{ marginTop: "var(--space-block)" }}>
          {services.map((service) => (
            <Fragment key={service.id}>
              <RuleDivider ticks={ticks} />
              <article style={{ paddingBlock: "var(--space-inline)" }}>
                <h3 style={SERVICE_NAME_TEXT}>{service.name.value}</h3>
                {serviceSummary(service, { marginTop: "var(--space-inline)", maxWidth: "62ch" })}
                {serviceBody(service)}
              </article>
            </Fragment>
          ))}
        </div>
      );
    }

    return (
      <div style={{ marginTop: "var(--space-block)" }}>
        {services.map((service) => (
          <article key={service.id} style={ROW}>
            <h3 style={SERVICE_NAME_TEXT}>{service.name.value}</h3>
            {serviceSummary(service, { marginTop: "var(--space-inline)", maxWidth: "62ch" })}
            {serviceBody(service)}
          </article>
        ))}
      </div>
    );
  }

  // The blocks appear in the canonical order `resolveComposition` returns them
  // in, and only when it returns them: a fact nobody confirmed gets no
  // placeholder and no apology.
  return (
    <main
      className="min-h-screen overflow-x-hidden"
      // Every visual value below is a `var(--*)` reference into this one map.
      style={{
        ...toStyleAttribute(direction),
        background: "var(--surface)",
        color: "var(--ink)",
        fontFamily: "var(--font-body)",
      }}
      data-ground={direction.ground}
      data-device={direction.device}
    >
      {moves ? <style>{HERO_ENTRANCE_CSS}</style> : null}

      {has("navbar") ? (
        <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
          <div
            className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-6 py-5"
            style={{ color: "var(--ink)" }}
          >
            <a
              href="#inicio"
              className="truncate"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-small)",
                fontWeight: 500,
                textTransform: upper ? "uppercase" : "none",
                letterSpacing: upper ? "0.08em" : "0",
              }}
            >
              {brief.businessName.value}
            </a>
            <nav
              aria-label="Seções"
              className="flex gap-6"
              style={{ ...SMALL_TEXT, color: "var(--ink-muted)" }}
            >
              {has("about") ? <a href="#sobre">Sobre</a> : null}
              {has("services") ? <a href="#servicos">Serviços</a> : null}
              {has("contact") ? <a href="#contato">Contato</a> : null}
            </nav>
          </div>
        </header>
      ) : null}

      {has("hero") ? (
        <SiteSection id="inicio" ground={groundOf("hero")} spine={spine}>
          <div
            {...(moves ? { "data-hero-enter": "" } : {})}
            style={centred ? { textAlign: "center" } : undefined}
          >
            <h1
              style={{
                ...DISPLAY_TEXT,
                textTransform: upper ? "uppercase" : "none",
                maxWidth: "18ch",
                marginInline: centred ? "auto" : undefined,
              }}
            >
              {brief.businessName.value}
            </h1>
            <p
              style={{
                ...BODY_TEXT,
                marginTop: "var(--space-block)",
                color: "var(--ink-muted)",
                maxWidth: "62ch",
                marginInline: centred ? "auto" : undefined,
              }}
            >
              {brief.positioning.value}
            </p>
            {has("contact") ? (
              <a
                href="#contato"
                className="inline-block"
                style={{
                  ...SMALL_TEXT,
                  marginTop: "var(--space-block)",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--accent)",
                  // The accent draws the edge, never the words: on the fitness
                  // direction accent over ground is 1.32:1.
                  color: "var(--ink)",
                }}
              >
                Falar com {brief.businessName.value}
              </a>
            ) : null}
          </div>
        </SiteSection>
      ) : null}

      {has("about") ? (
        <SiteSection id="sobre" ground={groundOf("about")} spine={spine}>
          <SectionHeading>Sobre</SectionHeading>
          <div style={{ marginTop: "var(--space-block)", maxWidth: "62ch" }}>
            <p style={{ ...BODY_TEXT, color: "var(--ink-muted)" }}>{brief.objective.value}</p>
            <p
              style={{
                ...BODY_TEXT,
                marginTop: "var(--space-inline)",
                color: "var(--ink-muted)",
              }}
            >
              {brief.audience.value}
            </p>
          </div>
        </SiteSection>
      ) : null}

      {has("differentiators") ? (
        <SiteSection id="diferenciais" ground={groundOf("differentiators")} spine={spine}>
          <SectionHeading>Diferenciais</SectionHeading>
          <ul style={{ marginTop: "var(--space-block)", maxWidth: "62ch", listStyle: "none" }}>
            {brief.differentiators.map((item) => (
              <li key={item.value} style={{ ...ROW, ...BODY_TEXT }}>
                {item.value}
              </li>
            ))}
          </ul>
        </SiteSection>
      ) : null}

      {has("services") ? (
        <SiteSection id="servicos" ground={groundOf("services")} spine={spine}>
          <SectionHeading>Serviços</SectionHeading>
          {renderServices()}
        </SiteSection>
      ) : null}

      {has("hours") ? (
        <SiteSection id="horarios" ground={groundOf("hours")} spine={spine}>
          <SectionHeading>Horários</SectionHeading>
          <dl
            style={{
              marginTop: "var(--space-block)",
              maxWidth: "44ch",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hours.map((entry, index) => (
              <div
                key={`${entry.dayOfWeek}-${index}`}
                className="flex items-baseline justify-between gap-4"
                style={ROW}
              >
                <dt style={BODY_TEXT}>{DAY_LABELS[entry.dayOfWeek]}</dt>
                <dd style={{ ...BODY_TEXT, color: "var(--ink-muted)" }}>
                  {entry.opens}–{entry.closes}
                </dd>
              </div>
            ))}
          </dl>
        </SiteSection>
      ) : null}

      {/* The `contact.address` conjunct narrows the type for TypeScript; it is
          not a second gate. `location` is available only when the address is
          confirmed, so has("location") already implies it. */}
      {has("location") && contact.address ? (
        <SiteSection id="localizacao" ground={groundOf("location")} spine={spine}>
          <SectionHeading>Localização</SectionHeading>
          <address
            style={{
              ...BODY_TEXT,
              marginTop: "var(--space-block)",
              fontStyle: "normal",
              color: "var(--ink-muted)",
            }}
          >
            {addressLines(contact.address.value).map((line) => (
              <span key={line} style={{ display: "block" }}>
                {line}
              </span>
            ))}
          </address>
        </SiteSection>
      ) : null}

      {has("contact") ? (
        <SiteSection id="contato" ground={groundOf("contact")} spine={spine}>
          <SectionHeading>Contato</SectionHeading>
          <ul style={{ marginTop: "var(--space-block)", maxWidth: "48ch", listStyle: "none" }}>
            {contactRows}
          </ul>
        </SiteSection>
      ) : null}

      {has("footer") ? (
        <footer style={{ background: "var(--surface)", borderTop: "1px solid var(--line)" }}>
          <div
            className="mx-auto max-w-5xl px-6"
            style={{ ...SMALL_TEXT, paddingBlock: "var(--space-block)", color: "var(--ink-muted)" }}
          >
            {brief.city
              ? `${brief.businessName.value}, ${brief.city.value}`
              : brief.businessName.value}
          </div>
        </footer>
      ) : null}
    </main>
  );
}
