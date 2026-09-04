import { ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { CategoryMotif } from "@/components/sites/category-motif";
import { resolveArtDirection } from "@/lib/design/art-direction";
import { resolveComposition, type BlockId } from "@/lib/design/blocks";
import { resolveHeroPalette, toStyleAttribute } from "@/lib/design/tokens";
import {
  BRIEF_DAYS,
  briefPublicContact,
  isSiteBriefV2,
  type BriefService,
  type SiteBrief,
} from "@/lib/site-factory/brief-schema";
import { publicBusinessName } from "@/lib/site-factory/display-name";

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

/**
 * The hero, as one stylesheet.
 *
 * Written as CSS rather than as inline styles because the hero is the one
 * block on the page whose layout actually changes with the viewport — two
 * columns above 900px, stacked below — and an inline `style` cannot hold a
 * media query. It also keeps the hero self-contained: nothing here depends on
 * a utility framework being loaded, so the exported snapshot and the preview
 * open identically.
 *
 * Every value still resolves through the direction's custom properties. The
 * four `--hero-*` tokens are the only new addressing: on a direction whose
 * hero inherits they are byte-identical to `--surface`/`--ink`, so this same
 * sheet paints a one-ground page without a second code path.
 */
const HERO_CSS =
  ".site-hero{position:relative;isolation:isolate;overflow:hidden;display:flex;" +
  // Not `--space-section`: on an `airy` direction that is 9rem top and bottom,
  // which alone is a fifth of a phone screen. The hero's own vertical budget
  // is what keeps the stacked layout inside the fold.
  "align-items:center;padding-block:clamp(2rem,8vw,3.5rem)}" +
  // Bled past the section on every side, because the 12s drift translates this
  // box: at `inset:0` the movement pulled its own edge into view and left an
  // unlit strip down the left of the hero, which read as a seam between the
  // header and the opening. The section clips whatever spills.
  ".site-hero-spotlight{position:absolute;inset:-10%;z-index:0;pointer-events:none}" +
  // Kept off-square and off-canvas, as in the reference: the light has to
  // arrive from somewhere outside the frame, or it reads as a painted blob.
  ".site-hero-beam{position:absolute;top:-42%;left:-14%;width:86%;height:150%}" +
  // On a light ground the same geometry is not light, it is a stain: a beam
  // covering half the section reads as dirt in the JPEG, and a hue at 18%
  // reads far stronger over white than a neutral at 20% does over black. So
  // the light ground gets a small neutral focus behind the object instead —
  // `--hero-spotlight` resolves to the ink at 6% there, not to the accent.
  '.site-hero[data-hero-ground="light"] .site-hero-beam{top:-4%;left:auto;right:2%;' +
  "width:44%;height:90%}" +
  ".site-hero-inner{position:relative;z-index:1;width:100%;max-width:64rem;margin-inline:auto;" +
  "padding-inline:1.5rem;display:grid;gap:2rem;align-items:center}" +
  ".site-hero-title{margin:0;font-family:var(--font-display);" +
  "font-size:clamp(2.6rem,12vw,4rem);" +
  "line-height:0.95;letter-spacing:var(--tracking-display);color:var(--hero-ink)}" +
  ".site-hero-lede{margin:var(--space-block) 0 0;font-family:var(--font-body);" +
  "font-size:var(--text-body);line-height:var(--leading-body);color:var(--hero-ink-muted);" +
  "max-width:34ch}" +
  ".site-hero-cta{display:inline-block;margin-top:var(--space-block);padding:0.75rem 1.5rem;" +
  "border:1px solid var(--hero-accent);border-radius:var(--radius);font-family:var(--font-body);" +
  "font-size:var(--text-small);line-height:var(--leading-small);color:var(--hero-ink)}" +
  // The motif is square, so capping the box's width caps its height too. On a
  // phone that is the whole point: a 320px drawing under three lines of
  // display type pushed the object past the fold and the bottom of it was
  // cut off — and a motif sliced by the screen edge is worse than none.
  ".site-hero-art{display:flex;align-items:center;justify-content:center;width:100%;" +
  "max-width:min(15rem,34vh);margin-inline:auto}" +
  // `facade-symmetry` is a device about a symmetric shopfront, and a headline
  // pushed to one side is the opposite of that. It keeps the single centred
  // column it has always had; the motif stands under the copy, on the axis.
  '.site-hero[data-hero-centred=""] .site-hero-inner{max-width:46rem;text-align:center;' +
  "justify-items:center}" +
  '.site-hero[data-hero-centred=""] .site-hero-lede{margin-inline:auto}' +
  "@media (min-width:900px){" +
  ".site-hero{min-height:88vh;padding-block:var(--space-section)}" +
  // A fixed gap, not `--space-section`: on the two `airy` directions a 9rem
  // gutter ate the right column and the object came out at 232px, reading as
  // an icon rather than as the thing the owner wanted to see. At 4rem every
  // direction gives the motif the same ~410px.
  // `minmax(0, …)` on the copy track and a floor on the art track, because a
  // bare `1.1fr` is `minmax(auto, 1.1fr)`: the longest word of the business
  // name became the column's minimum, and a name like "Consultório" grew the
  // left column past its share and squeezed the object down to 261px, where
  // it reads as an icon. The type now wraps — hyphenated where the language
  // allows it — and the object keeps its column.
  ".site-hero-inner{grid-template-columns:minmax(0,1.1fr) minmax(24rem,0.9fr);gap:4rem}" +
  ".site-hero-title{hyphens:auto;overflow-wrap:break-word}" +
  ".site-hero-title{font-size:clamp(3rem,8vw,7rem)}" +
  ".site-hero-art{max-width:none;min-height:24rem}" +
  // The stacked hero pays for its axis: it is taller than a two-column one by
  // the whole height of the object, so it takes the block step instead of the
  // section step and still opens inside a laptop's fold.
  '.site-hero[data-hero-centred=""]{padding-block:var(--space-block)}' +
  '.site-hero[data-hero-centred=""] .site-hero-inner{grid-template-columns:1fr;' +
  "gap:var(--space-block)}" +
  '.site-hero[data-hero-centred=""] .site-hero-art{max-width:24rem;min-height:0}' +
  "}" +
  // The one entrance the reversal grants, and the one slow loop that keeps the
  // light from looking painted on. Both stop dead under reduced motion.
  "@media (prefers-reduced-motion: no-preference){" +
  "@keyframes site-hero-spotlight{from{opacity:0;transform:translate(-8%,-6%) scale(0.86)}" +
  "to{opacity:1;transform:translate(0,0) scale(1)}}" +
  ".site-hero-beam{animation:site-hero-spotlight 2s ease 0.2s both}" +
  "@keyframes site-hero-drift{0%{transform:translate3d(0,0,0)}" +
  "50%{transform:translate3d(2.5%,1.5%,0)}100%{transform:translate3d(0,0,0)}}" +
  ".site-hero-spotlight{animation:site-hero-drift 12s ease-in-out infinite}" +
  "}";

/**
 * The light, as the reference draws it.
 *
 * One rotated ellipse under a 151-unit Gaussian blur — the Aceternity
 * spotlight, geometry unchanged, recoloured through `--hero-spotlight`
 * (white on a black hero, the accent at 18% on a light one). It is marked
 * `data-hero-spotlight` because that marker is what `findSlop` strips: the
 * gradient and the blur are granted here, once, and nowhere else on the page.
 */
function HeroSpotlight() {
  return (
    <div
      data-hero-spotlight=""
      aria-hidden="true"
      className="site-hero-spotlight"
      // The ambient half of the light: a small halo behind the object, so the
      // motif sits *in* the light instead of floating beside it. Kept tight —
      // a wash across the whole section is the gradient the rules forbid.
      style={{
        background:
          "radial-gradient(34% 30% at 74% 34%, var(--hero-spotlight), transparent 70%)",
      }}
    >
      <svg
        className="site-hero-beam"
        viewBox="0 0 3787 2842"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g filter="url(#site-hero-beam-blur)">
          <ellipse
            cx="1924.71"
            cy="273.501"
            rx="1924.71"
            ry="273.501"
            transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
            fill="var(--hero-spotlight)"
          />
        </g>
        <defs>
          <filter
            id="site-hero-beam-blur"
            x="0.860352"
            y="0.838989"
            width="3785.16"
            height="2840.26"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="151" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}

/**
 * The levels set in the display face, as functions of a resolved weight.
 *
 * `weight` is computed once per render, in `ProjectSite`, from the direction's
 * display face: Instrument Serif ships only weight 400, and any heavier value
 * asked of it is a browser-synthesized ("fake") bold, so directions on that
 * face collapse every level to 400. Every other display face keeps its
 * nominal weight (500 here, 600 for `serviceNameText`, 700 on the hero
 * headline). These stay plain functions of the weight they are given, not of
 * the direction itself, so they remain pure and module-scoped like the other
 * helpers below.
 *
 * The `--text-display` step has no consumer here any more: the hero headline
 * is the only thing that ever used it, and since the reversal it is sized by
 * `clamp(3rem, 8vw, 7rem)` instead. The token is still emitted, because the
 * agent building the client's own site still needs a display step.
 */
function headingText(weight: number): CSSProperties {
  return {
    fontFamily: "var(--font-display)",
    fontSize: "var(--text-heading)",
    lineHeight: "var(--leading-heading)",
    letterSpacing: "var(--tracking-heading)",
    fontWeight: weight,
  };
}

/**
 * The service name: the third level.
 *
 * A service name set in `headingText` is byte-identical to the section heading
 * above it, which leaves the one block long enough to have hierarchy with none.
 * Body size in the display face at 600 (400 on Instrument Serif, see above)
 * sits between the 2rem section heading and the 400-weight summary without
 * adding a fifth size to the scale.
 */
function serviceNameText(weight: number): CSSProperties {
  return {
    fontFamily: "var(--font-display)",
    fontSize: "var(--text-body)",
    lineHeight: "var(--leading-body)",
    fontWeight: weight,
  };
}

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

/**
 * A contact channel, as a box.
 *
 * The only place on the page where `--radius` shapes a container. Contact is
 * the block where a shape is legible — a short list of separate destinations,
 * each of which is one thing you can do — and it is the one block every site
 * with a confirmed channel has. Directions whose radius is `none` get square
 * boxes; `pet` (`lg`) and `health` (`md`) round, which is the whole point of
 * a direction declaring a radius. No shadow: the border is the edge.
 */
const CONTACT_BOX: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  padding: "var(--space-inline)",
};

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

/**
 * A section heading, with the accent as a rule beneath it.
 *
 * The accent as *régua*: a 40x2px mark under every `<h2>`, in all four
 * families, which is a few hundred pixels across a whole page — well inside
 * the 5% of rule `accent-flood` — and never a letterform, so it can never
 * fail contrast the way accent-coloured text would. On `retail` and `events`
 * the accent equals the ink, so the mark reads as an ink rule; that is the
 * direction speaking, not a defect.
 */
function SectionHeading({ weight, children }: { weight: number; children: ReactNode }) {
  return (
    <>
      <h2 style={headingText(weight)}>{children}</h2>
      <div
        aria-hidden="true"
        style={{
          display: "block",
          width: "2.5rem",
          height: "2px",
          // Half the inline step: the heading and its rule are one unit, and
          // a full step would read as a separator between two things.
          marginTop: "calc(var(--space-inline) / 2)",
          background: "var(--accent)",
        }}
      />
    </>
  );
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
  const about = (isSiteBriefV2(brief) ? brief.about : null) ?? null;
  const has = (block: BlockId) => blocks.includes(block);

  // The name as every publishing surface sets it. The fact itself is untouched
  // — this only decides how the confirmed string is typeset, so an imported
  // "ZEN COMIDA JAPONESA" stops shouting at the visitor, and the page, its
  // `<title>`, the snapshot and the agent's prompt all print the same thing.
  const name = publicBusinessName(brief);

  // Instrument Serif ships a single real weight (400); any heavier value on
  // it forces the browser to synthesize ("fake") bold, which the type system
  // does not allow. Every other display face keeps its nominal weight.
  // Hierarchy between the heading and service-name levels still holds when
  // both collapse to 400, because the two levels already differ by size
  // (--text-heading vs --text-body).
  const isInstrumentSerif = direction.type.display === "instrument-serif";
  const headingWeight = isInstrumentSerif ? 400 : 500;
  const serviceWeight = isInstrumentSerif ? 400 : 600;

  const family = deviceFamily(direction.device);
  const upper = direction.type.displayCase === "upper";
  const centred = direction.device === "facade-symmetry";
  const moves = direction.motion.moment !== "none";
  // The hero's own palette. Every colour it paints with reaches it as a custom
  // property, so nothing branches on the ground itself — only the header's
  // bottom border, which exists to hide a seam that an inverted hero does not
  // have.
  const hero = resolveHeroPalette(direction);
  const heroInverted = hero.ground !== direction.ground;

  // The two dense families drop the summary to `--text-small` so the structure,
  // not the prose, carries the row. Everything else — `large-body` above all —
  // keeps it at body size.
  const summarySize =
    family === "leader" || family === "index" ? "var(--text-small)" : "var(--text-body)";

  // One ground: `--surface` and `--surface-alt` alternate down the page, over
  // the blocks actually present, so a missing block never leaves two identical
  // grounds touching *between content blocks*. The footer is not part of this
  // alternation — it is always `--surface` — so with an odd number of content
  // blocks the last one lands on `--surface` too and touches the footer with
  // no visible seam; that case is resolved visually by the footer's
  // `borderTop` rule rather than by this alternation.
  const contentBlocks: BlockId[] = blocks.filter(
    (block) => block !== "navbar" && block !== "footer",
  );
  const groundOf = (block: BlockId) =>
    contentBlocks.indexOf(block) % 2 === 0 ? "var(--surface)" : "var(--surface-alt)";

  const contactRows: ReactNode[] = [];
  if (contact.phone) {
    contactRows.push(
      <li key="phone" style={CONTACT_BOX}>
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
      <li key="whatsapp" style={CONTACT_BOX}>
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
      <li key="email" style={CONTACT_BOX}>
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
      <li key={social.value.url} style={CONTACT_BOX}>
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

  // The price is a confirmed fact, so it is set in ink, not in the muted tone
  // the summary uses — and it is published exactly as the operator typed it
  // ("R$ 28,00", "a partir de R$ 90", "sob consulta"). Formatting it would mean
  // deciding a currency and a rounding nobody confirmed.
  const servicePrice = (service: BriefService, extra?: CSSProperties) =>
    service.price ? (
      <p style={{ ...SMALL_TEXT, color: "var(--ink)", ...extra }}>{service.price.value}</p>
    ) : null;

  // The two ruled families give the price its own trailing column, so the
  // figures line up down the page instead of ending wherever the summary does.
  // The column exists for the whole list or not at all: a per-row grid would
  // put each price at a different x.
  const pricedColumn = services.some((service) => service.price !== null);

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
                <h3 style={{ ...serviceNameText(serviceWeight), flex: "0 0 auto" }}>{service.name.value}</h3>
                <span
                  aria-hidden="true"
                  style={{ flex: "1 1 2rem", borderBottom: "1px dotted var(--line)" }}
                />
                {serviceSummary(service, { flex: "0 1 34ch", textAlign: "right" })}
                {pricedColumn
                  ? servicePrice(service, { flex: "0 0 auto", textAlign: "right" })
                  : null}
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
                  gridTemplateColumns: pricedColumn
                    ? "minmax(9rem, 18rem) 1fr auto"
                    : "minmax(9rem, 18rem) 1fr",
                  gap: "var(--space-inline)",
                }}
              >
                <h3 style={serviceNameText(serviceWeight)}>{service.name.value}</h3>
                {serviceSummary(service, { maxWidth: "62ch" })}
                {pricedColumn ? servicePrice(service, { textAlign: "right" }) : null}
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
                <h3 style={serviceNameText(serviceWeight)}>{service.name.value}</h3>
                {servicePrice(service, { marginTop: "calc(var(--space-inline) / 2)" })}
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
            <h3 style={serviceNameText(serviceWeight)}>{service.name.value}</h3>
            {servicePrice(service, { marginTop: "calc(var(--space-inline) / 2)" })}
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
      {has("hero") ? <style>{HERO_CSS}</style> : null}
      {moves ? <style>{HERO_ENTRANCE_CSS}</style> : null}

      {/* The header stands on the hero's ground, not the body's.
          On a direction whose hero inherits, the two are the same colour and
          nothing changes. On the five inverted ones, painting it `--surface`
          left a white band pasted over a black hero — three grounds down the
          page instead of two, and the opposite of a full-bleed opening. The
          rule below is the whole difference; the body keeps its own ground.
          The bottom border goes with it: over a black hero there is no seam to
          draw, and a `--line` rule from a light palette would be a bright
          scratch across the top of the page. */}
      {has("navbar") ? (
        <header
          style={{
            background: "var(--hero-surface)",
            borderBottom: heroInverted ? "none" : "1px solid var(--line)",
          }}
        >
          <div
            className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-6 py-5"
            style={{ color: "var(--hero-ink)" }}
          >
            <a
              href="#inicio"
              className="truncate"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-small)",
                fontWeight: headingWeight,
                textTransform: upper ? "uppercase" : "none",
                letterSpacing: upper ? "0.08em" : "0",
              }}
            >
              {name}
            </a>
            <nav
              aria-label="Seções"
              className="flex gap-6"
              style={{ ...SMALL_TEXT, color: "var(--hero-ink-muted)" }}
            >
              {has("about") ? <a href="#sobre">Sobre</a> : null}
              {has("services") ? <a href="#servicos">Serviços</a> : null}
              {has("contact") ? <a href="#contato">Contato</a> : null}
            </nav>
          </div>
        </header>
      ) : null}

      {has("hero") ? (
        <section
          id="inicio"
          className="site-hero"
          // The anchor for two readers: `findSlop`, which only grants the
          // gradient and the blur to a spotlight or a motif found *inside*
          // this element, and the fold measurement in `scripts/`.
          data-hero=""
          data-hero-ground={hero.ground}
          {...(centred ? { "data-hero-centred": "" } : {})}
          style={{ background: "var(--hero-surface)", color: "var(--hero-ink)" }}
        >
          <HeroSpotlight />
          <div className="site-hero-inner">
            <div {...(moves ? { "data-hero-enter": "" } : {})}>
              <h1
                className="site-hero-title"
                style={{
                  textTransform: upper ? "uppercase" : "none",
                  // The impact comes from the size, never from a gradient
                  // fill on the letters: rule 1 still holds over the text.
                  fontWeight: isInstrumentSerif ? 400 : 700,
                }}
              >
                {name}
              </h1>
              <p className="site-hero-lede">{brief.positioning.value}</p>
              {has("contact") ? (
                <a href="#contato" className="site-hero-cta">
                  Falar com {name}
                </a>
              ) : null}
            </div>
            <div className="site-hero-art">
              <CategoryMotif motif={direction.hero.motif} />
            </div>
          </div>
        </section>
      ) : null}

      {/* `about` is available only when the presentation text was confirmed,
          so the conjunct narrows the type rather than gating a second time.
          The brief's `objective` and `audience` are operator-facing notes and
          are deliberately absent from this file. */}
      {has("about") && about ? (
        <SiteSection id="sobre" ground={groundOf("about")} spine={spine}>
          <SectionHeading weight={headingWeight}>Sobre</SectionHeading>
          <div style={{ marginTop: "var(--space-block)", maxWidth: "62ch" }}>
            <p style={{ ...BODY_TEXT, color: "var(--ink-muted)" }}>{about.value}</p>
          </div>
        </SiteSection>
      ) : null}

      {has("differentiators") ? (
        <SiteSection id="diferenciais" ground={groundOf("differentiators")} spine={spine}>
          <SectionHeading weight={headingWeight}>Diferenciais</SectionHeading>
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
          <SectionHeading weight={headingWeight}>Serviços</SectionHeading>
          {renderServices()}
        </SiteSection>
      ) : null}

      {has("hours") ? (
        <SiteSection id="horarios" ground={groundOf("hours")} spine={spine}>
          <SectionHeading weight={headingWeight}>Horários</SectionHeading>
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
          <SectionHeading weight={headingWeight}>Localização</SectionHeading>
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
          <SectionHeading weight={headingWeight}>Contato</SectionHeading>
          <ul
            style={{
              marginTop: "var(--space-block)",
              maxWidth: "48ch",
              listStyle: "none",
              display: "grid",
              // The boxes are parted by space, not by a shared border: two
              // adjacent 1px borders would read as a 2px rule and undo the
              // separation the box is there to make.
              gap: "calc(var(--space-inline) / 2)",
            }}
          >
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
            {brief.city ? `${name}, ${brief.city.value}` : name}
          </div>
        </footer>
      ) : null}
    </main>
  );
}
