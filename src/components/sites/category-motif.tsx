import type { CSSProperties, ReactNode } from "react";

import type { MotifId } from "@/lib/design/art-direction";

/**
 * The object in the hero, drawn per category.
 *
 * The owner asked for the impact of a full-viewport hero with a striking
 * object beside the headline (spec §13, errata 6). The reference put a
 * generic 3D robot there. A robot has nothing to do with a pizzeria, so this
 * draws the *trade's own* object instead: an azulejo wall for a kitchen, a
 * barber pole and razor for a shop, a scoreboard for a gym. Fourteen of them,
 * one per category, inline SVG — no raster, no `<foreignObject>`, no runtime
 * dependency, a few kilobytes each.
 *
 * The rules every motif keeps:
 *
 * - **No published text.** Decorative numerals are allowed (they assert
 *   nothing); words are not. Nothing here can become a claim about the
 *   business.
 * - **Colour only through custom properties** — `--hero-ink`, `--hero-accent`,
 *   `--hero-surface`. `--line` is deliberately unused: on a dark hero over a
 *   light direction it is nearly as bright as the ink, so structure would stop
 *   reading as structure. Ink at a low opacity does the same job on both
 *   grounds.
 * - **One slow loop**, 8 to 14 seconds, inside a `<style>` scoped by the
 *   motif id and wrapped in `prefers-reduced-motion: no-preference`. Nothing
 *   moves for a person who asked for stillness.
 * - **At most sixty elements**, so the markup stays smaller than the single
 *   photograph it replaces.
 *
 * The whole `<svg>` is marked `data-category-motif`, which is what
 * `findSlop()` strips before applying the anti-slop rules: the blur in
 * `luz-difusa` is granted here and nowhere else.
 */

const VIEWBOX = 480;

/** Wraps a motif's keyframes so a person who asked for stillness gets it. */
function motion(css: string): string {
  return `@media (prefers-reduced-motion:no-preference){${css}}`;
}

function polar(cx: number, cy: number, r: number, angle: number): string {
  return `${(cx + r * Math.cos(angle)).toFixed(1)} ${(cy + r * Math.sin(angle)).toFixed(1)}`;
}

/** A flat-topped gear outline: teeth with real flanks, not a star. */
function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const seg = (Math.PI * 2) / teeth;
  const crown = seg * 0.26;
  const flank = seg * 0.12;
  const points: string[] = [];
  for (let index = 0; index < teeth; index += 1) {
    const a = index * seg;
    points.push(polar(cx, cy, outer, a - crown));
    points.push(polar(cx, cy, outer, a + crown));
    points.push(polar(cx, cy, inner, a + crown + flank));
    points.push(polar(cx, cy, inner, a + seg - crown - flank));
  }
  return `M${points.join("L")}Z`;
}

/** One paw: a pad and four toes, turned by `tilt` degrees. */
function paw(x: number, y: number, tilt: number, index: number): ReactNode {
  const toes: [number, number][] = [
    [-24, -26],
    [-9, -37],
    [9, -37],
    [24, -26],
  ];
  return (
    <g key={`paw-${index}`} className={`m-pt-paw m-pt-paw-${index}`} transform={`rotate(${tilt} ${x} ${y})`}>
      <ellipse cx={x} cy={y} rx={27} ry={22} fill="var(--hero-accent)" fillOpacity={0.42} />
      {toes.map(([dx, dy], toe) => (
        <circle
          key={toe}
          cx={x + dx}
          cy={y + dy}
          r={10}
          fill="var(--hero-accent)"
          fillOpacity={0.42}
        />
      ))}
    </g>
  );
}

type Motif = { css: string; art: ReactNode };

const azulejo: Motif = {
  // Six rows of tiles; one row at a time takes the glaze, top to bottom.
  css: motion(
    "@keyframes motif-azulejo{0%{opacity:0}4%{opacity:1}14%{opacity:1}20%{opacity:0}100%{opacity:0}}" +
      '[data-motif="azulejo"] .m-az-rows rect{opacity:0;animation:motif-azulejo 12s linear infinite}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(1){animation-delay:0s}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(2){animation-delay:2s}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(3){animation-delay:4s}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(4){animation-delay:6s}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(5){animation-delay:8s}' +
      '[data-motif="azulejo"] .m-az-rows rect:nth-child(6){animation-delay:10s}',
  ),
  art: (
    <>
      <defs>
        {(["quiet", "lit"] as const).map((key) => {
          const stroke = key === "lit" ? "var(--hero-accent)" : "var(--hero-ink)";
          const strong = key === "lit" ? 1 : 0.58;
          const soft = key === "lit" ? 0.7 : 0.3;
          return (
            <pattern
              key={key}
              id={`motif-azulejo-${key}`}
              x={24}
              y={24}
              width={72}
              height={72}
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M36 6L66 36L36 66L6 36Z"
                fill="none"
                stroke={stroke}
                strokeOpacity={strong}
                strokeWidth={1.6}
              />
              <path
                d="M0 20A20 20 0 0 0 20 0M52 0A20 20 0 0 0 72 20M72 52A20 20 0 0 0 52 72M20 72A20 20 0 0 0 0 52"
                fill="none"
                stroke={stroke}
                strokeOpacity={soft}
                strokeWidth={1.6}
              />
              <circle cx={36} cy={36} r={6} fill={stroke} fillOpacity={strong} />
              <rect x={0} y={0} width={72} height={72} fill="none" stroke={stroke} strokeOpacity={soft} />
            </pattern>
          );
        })}
      </defs>
      <rect x={24} y={24} width={432} height={432} fill="url(#motif-azulejo-quiet)" />
      <g className="m-az-rows">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <rect
            key={row}
            x={24}
            y={24 + row * 72}
            width={432}
            height={72}
            fill="url(#motif-azulejo-lit)"
          />
        ))}
      </g>
      <rect
        x={24}
        y={24}
        width={432}
        height={432}
        fill="none"
        stroke="var(--hero-ink)"
        strokeOpacity={0.5}
        strokeWidth={2}
      />
    </>
  ),
};

const navalha: Motif = {
  // The pole turns; the razor stays still, which is the whole picture.
  css: motion(
    "@keyframes motif-navalha{from{transform:translateY(0)}to{transform:translateY(76px)}}" +
      '[data-motif="navalha"] .m-nv-stripes{animation:motif-navalha 11s linear infinite}',
  ),
  art: (
    <>
      <defs>
        <clipPath id="motif-navalha-pole">
          <rect x={96} y={70} width={92} height={340} rx={46} />
        </clipPath>
      </defs>
      <rect x={96} y={70} width={92} height={340} rx={46} fill="var(--hero-ink)" fillOpacity={0.07} />
      <g clipPath="url(#motif-navalha-pole)">
        <g className="m-nv-stripes">
          {Array.from({ length: 10 }, (_, index) => {
            const y = -80 + index * 76;
            return (
              <path
                key={index}
                d={`M96 ${y}L188 ${y - 60}L188 ${y - 22}L96 ${y + 38}Z`}
                fill="var(--hero-accent)"
                fillOpacity={0.75}
              />
            );
          })}
        </g>
      </g>
      <rect
        x={96}
        y={70}
        width={92}
        height={340}
        rx={46}
        fill="none"
        stroke="var(--hero-ink)"
        strokeOpacity={0.55}
        strokeWidth={2}
      />
      <ellipse cx={142} cy={70} rx={54} ry={16} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2} />
      <ellipse cx={142} cy={410} rx={54} ry={16} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2} />

      {/* A straight razor, open: the blade folded up off the pivot, the scale
          hanging below it. Drawn in line, at the same weight as the pole. */}
      <g stroke="var(--hero-ink)" strokeWidth={2.6} fill="none" strokeLinejoin="round">
        <path d="M268 352L398 176Q410 160 424 172Q437 184 428 198L296 372Z" strokeOpacity={0.85} />
        <path d="M256 378L246 448Q262 466 280 450L292 378" strokeOpacity={0.7} />
        <path d="M262 404L286 402" strokeOpacity={0.35} />
      </g>
      <path
        d="M280 356L404 188"
        stroke="var(--hero-accent)"
        strokeWidth={3.4}
        strokeLinecap="round"
      />
      <circle cx={274} cy={372} r={9} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.85} strokeWidth={2.6} />
    </>
  ),
};

const placar: Motif = {
  // A ten-step roll: the last digit turns over once every 1.2 seconds.
  css:
    '[data-motif="placar"] .m-pl-num{font-family:var(--font-display);font-size:112px;' +
    "font-variant-numeric:tabular-nums;letter-spacing:0.02em;fill:var(--hero-accent)}" +
    motion(
      "@keyframes motif-placar{from{transform:translateY(0)}to{transform:translateY(-1120px)}}" +
        '[data-motif="placar"] .m-pl-roll{animation:motif-placar 12s steps(10) infinite}',
    ),
  art: (
    <>
      <defs>
        <pattern id="motif-placar-dots" width={18} height={18} patternUnits="userSpaceOnUse">
          <circle cx={9} cy={9} r={2.6} fill="var(--hero-ink)" fillOpacity={0.4} />
        </pattern>
        {/* Shorter than the 112 of the roll's pitch, so only one digit is ever
            in the window and the neighbours' tails stay outside it. */}
        <clipPath id="motif-placar-roll">
          <rect x={300} y={196} width={104} height={104} />
        </clipPath>
      </defs>
      <rect x={40} y={78} width={400} height={40} fill="url(#motif-placar-dots)" />
      <rect x={40} y={370} width={400} height={40} fill="url(#motif-placar-dots)" />
      <rect
        x={40}
        y={138}
        width={400}
        height={204}
        rx={6}
        fill="var(--hero-ink)"
        fillOpacity={0.05}
        stroke="var(--hero-ink)"
        strokeOpacity={0.55}
        strokeWidth={2}
      />
      <rect x={58} y={156} width={364} height={168} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.2} />
      <path d="M58 240L94 240M386 240L422 240" stroke="var(--hero-ink)" strokeOpacity={0.25} strokeWidth={2} />
      <text className="m-pl-num" x={76} y={280}>
        00:0
      </text>
      <g clipPath="url(#motif-placar-roll)">
        <g className="m-pl-roll">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, index) => (
            <text key={index} className="m-pl-num" x={310} y={280 + index * 112}>
              {digit}
            </text>
          ))}
        </g>
      </g>
    </>
  ),
};

const patas: Motif = {
  // The prints arrive in order, as if something just walked across.
  css: motion(
    "@keyframes motif-patas{0%{opacity:0}8%{opacity:1}52%{opacity:1}72%{opacity:0}100%{opacity:0}}" +
      '[data-motif="patas"] .m-pt-paw{opacity:0;animation:motif-patas 12s ease-in-out infinite}' +
      '[data-motif="patas"] .m-pt-paw-1{animation-delay:1.6s}' +
      '[data-motif="patas"] .m-pt-paw-2{animation-delay:3.2s}' +
      '[data-motif="patas"] .m-pt-paw-3{animation-delay:4.8s}' +
      '[data-motif="patas"] .m-pt-paw-4{animation-delay:6.4s}',
  ),
  art: (
    <>
      {[236, 182, 128, 74].map((r, index) => (
        <circle
          key={r}
          cx={240}
          cy={240}
          r={r}
          fill="none"
          stroke="var(--hero-accent)"
          strokeOpacity={0.22 + index * 0.04}
          strokeWidth={2}
        />
      ))}
      {paw(126, 402, -14, 0)}
      {paw(196, 344, -6, 1)}
      {paw(152, 282, -14, 2)}
      {paw(228, 226, -4, 3)}
      {paw(186, 158, -12, 4)}
    </>
  ),
};

const manual: Motif = {
  css: motion(
    "@keyframes motif-manual{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}" +
      '[data-motif="manual"] .m-mn-gear{transform-box:view-box;transform-origin:212px 236px;' +
      "animation:motif-manual 14s linear infinite}",
  ),
  art: (
    <>
      <g className="m-mn-gear">
        <path
          d={gearPath(216, 244, 160, 128, 14)}
          fill="none"
          stroke="var(--hero-ink)"
          strokeOpacity={0.9}
          strokeWidth={3}
        />
        <circle cx={216} cy={244} r={104} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.35} strokeWidth={2} />
        <circle cx={216} cy={244} r={38} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.9} strokeWidth={3} />
        {[0, 1, 2, 3, 4].map((index) => {
          const angle = (index * Math.PI * 2) / 5 - Math.PI / 2;
          return (
            <circle
              key={index}
              cx={216 + 70 * Math.cos(angle)}
              cy={244 + 70 * Math.sin(angle)}
              r={10}
              fill="none"
              stroke="var(--hero-accent)"
              strokeWidth={3}
            />
          );
        })}
      </g>

      {/* The exploded part: the same hub, lifted off its axis. */}
      <circle
        cx={392}
        cy={96}
        r={54}
        fill="none"
        stroke="var(--hero-ink)"
        strokeOpacity={0.45}
        strokeWidth={2}
        strokeDasharray="9 8"
      />
      <circle cx={392} cy={96} r={20} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.45} strokeWidth={2} />
      <path d="M254 176L356 108" stroke="var(--hero-ink)" strokeOpacity={0.3} strokeWidth={1.4} strokeDasharray="5 6" />

      <g stroke="var(--hero-accent)" strokeWidth={1.8} fill="none">
        <path d="M40 244L40 404M30 244L50 244M30 404L50 404" />
        <path d="M40 324L112 324" strokeDasharray="4 5" />
      </g>
      <g stroke="var(--hero-ink)" strokeOpacity={0.5} strokeWidth={1.8} fill="none">
        <path d="M56 440L376 440M56 430L56 450M376 430L376 450" />
        <path d="M216 404L216 440" strokeDasharray="4 5" />
      </g>
    </>
  ),
};

const gradeHoraria: Motif = {
  css: motion(
    "@keyframes motif-grade{0%{opacity:0.12}12%{opacity:1}40%{opacity:1}56%{opacity:0.12}100%{opacity:0.12}}" +
      '[data-motif="grade-horaria"] .m-gh-block{animation:motif-grade 12s ease-in-out infinite}' +
      '[data-motif="grade-horaria"] .m-gh-block:nth-child(2){animation-delay:2.4s}' +
      '[data-motif="grade-horaria"] .m-gh-block:nth-child(3){animation-delay:4.8s}' +
      '[data-motif="grade-horaria"] .m-gh-block:nth-child(4){animation-delay:7.2s}' +
      '[data-motif="grade-horaria"] .m-gh-block:nth-child(5){animation-delay:9.6s}',
  ),
  art: (
    <>
      <rect x={30} y={60} width={420} height={54} fill="var(--hero-ink)" fillOpacity={0.07} />
      <g className="m-gh-blocks">
        <rect className="m-gh-block" x={92} y={130} width={54} height={94} fill="var(--hero-accent)" fillOpacity={0.75} />
        <rect className="m-gh-block" x={212} y={178} width={54} height={140} fill="var(--hero-accent)" fillOpacity={0.75} />
        <rect className="m-gh-block" x={152} y={272} width={54} height={94} fill="var(--hero-accent)" fillOpacity={0.75} />
        <rect className="m-gh-block" x={332} y={130} width={54} height={140} fill="var(--hero-accent)" fillOpacity={0.75} />
        <rect className="m-gh-block" x={272} y={320} width={54} height={46} fill="var(--hero-accent)" fillOpacity={0.75} />
      </g>
      <g stroke="var(--hero-ink)" strokeWidth={1.4} strokeOpacity={0.3}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <path key={`v${index}`} d={`M${92 + index * 60} 60L${92 + index * 60} 414`} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <path key={`h${index}`} d={`M30 ${114 + index * 50}L450 ${114 + index * 50}`} />
        ))}
      </g>
      <rect x={30} y={60} width={420} height={354} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={2} />
      <path d="M30 114L450 114" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={2} />
    </>
  ),
};

const vitrine: Motif = {
  css: motion(
    "@keyframes motif-vitrine{0%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}100%{transform:rotate(-4deg)}}" +
      '[data-motif="vitrine"] .m-vt-tag{transform-box:view-box;transform-origin:352px 92px;' +
      "animation:motif-vitrine 10s ease-in-out infinite}",
  ),
  art: (
    <>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={2}>
        <rect x={36} y={112} width={172} height={210} />
        <rect x={36} y={340} width={172} height={94} />
        <rect x={230} y={112} width={122} height={122} />
        <rect x={230} y={256} width={122} height={178} />
        <rect x={374} y={256} width={70} height={178} />
      </g>
      <rect x={36} y={112} width={172} height={210} fill="var(--hero-ink)" fillOpacity={0.06} />
      <rect x={230} y={256} width={122} height={178} fill="var(--hero-ink)" fillOpacity={0.06} />
      <g stroke="var(--hero-ink)" strokeOpacity={0.28} strokeWidth={1.4}>
        <path d="M60 372L184 372M60 396L146 396" />
        <path d="M254 300L328 300M254 328L306 328M254 356L328 356" />
      </g>
      <path d="M36 452L444 452" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={2} />
      <path d="M36 76L444 76" stroke="var(--hero-ink)" strokeOpacity={0.35} strokeWidth={2} />

      <g className="m-vt-tag">
        <path d="M352 76L352 150" stroke="var(--hero-ink)" strokeOpacity={0.85} strokeWidth={2.4} />
        <path d="M374 150L436 150L436 226L374 226L350 188Z" fill="var(--hero-accent)" fillOpacity={0.92} />
        <circle cx={374} cy={174} r={7} fill="var(--hero-surface)" />
        <path d="M392 194L422 194" stroke="var(--hero-surface)" strokeOpacity={0.8} strokeWidth={4} />
      </g>
    </>
  ),
};

const passePartout: Motif = {
  css: motion(
    "@keyframes motif-passe{0%{transform:translate(-40px,26px)}50%{transform:translate(46px,-20px)}" +
      "100%{transform:translate(-40px,26px)}}" +
      '[data-motif="passe-partout"] .m-pp-light{transform-box:view-box;animation:motif-passe 13s ease-in-out infinite}',
  ),
  art: (
    <>
      <defs>
        <filter id="motif-passe-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
        <clipPath id="motif-passe-window">
          <rect x={126} y={150} width={228} height={180} />
        </clipPath>
      </defs>
      <rect x={26} y={50} width={428} height={380} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.65} strokeWidth={2} />
      <rect x={58} y={82} width={364} height={316} fill="var(--hero-ink)" fillOpacity={0.05} stroke="var(--hero-ink)" strokeOpacity={0.35} strokeWidth={1.4} />
      <rect x={126} y={150} width={228} height={180} fill="var(--hero-ink)" fillOpacity={0.09} />
      <g clipPath="url(#motif-passe-window)">
        <ellipse className="m-pp-light" cx={240} cy={240} rx={112} ry={78} fill="var(--hero-accent)" fillOpacity={0.5} filter="url(#motif-passe-blur)" />
      </g>
      <rect x={126} y={150} width={228} height={180} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.75} strokeWidth={2} />
      <g stroke="var(--hero-ink)" strokeOpacity={0.3} strokeWidth={1.2}>
        <path d="M58 82L126 150M422 82L354 150M58 398L126 330M422 398L354 330" />
      </g>
      <path d="M126 372L354 372" stroke="var(--hero-accent)" strokeWidth={2.4} />
    </>
  ),
};

const planta: Motif = {
  css: motion(
    "@keyframes motif-planta{0%{stroke-dashoffset:268}55%{stroke-dashoffset:0}100%{stroke-dashoffset:0}}" +
      '[data-motif="planta"] .m-pl-cota{stroke-dasharray:268;animation:motif-planta 12s ease-in-out infinite}',
  ),
  art: (
    <>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.85} strokeWidth={5}>
        <path d="M76 96L404 96L404 356L76 356Z" />
        <path d="M246 96L246 232M246 288L246 356M76 232L166 232" />
      </g>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.45} strokeWidth={2}>
        <path d="M166 232A46 46 0 0 1 212 278" />
        <path d="M246 232A56 56 0 0 0 302 288" />
        <path d="M100 96L100 356" strokeDasharray="3 7" />
      </g>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={4}>
        <path d="M300 96L360 96M76 150L76 208" />
      </g>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.3} strokeWidth={1.6}>
        <rect x={300} y={266} width={78} height={64} />
        <rect x={116} y={272} width={92} height={56} />
      </g>
      <g stroke="var(--hero-ink)" strokeOpacity={0.4} strokeWidth={1.4}>
        <path d="M424 96L424 356M416 96L432 96M416 356L432 356" />
        <path d="M76 60L246 60M76 52L76 68M246 52L246 68" />
      </g>
      <g stroke="var(--hero-accent)" strokeWidth={2}>
        <path d="M76 400L344 400" className="m-pl-cota" />
        <path d="M76 392L76 408M344 392L344 408" />
      </g>
    </>
  ),
};

const encadernacao: Motif = {
  css: motion(
    "@keyframes motif-encad{0%{transform:translateY(0)}50%{transform:translateY(196px)}100%{transform:translateY(0)}}" +
      '[data-motif="encadernacao"] .m-en-ribbon{transform-box:view-box;animation:motif-encad 13s ease-in-out infinite}',
  ),
  art: (
    <>
      <rect x={44} y={46} width={392} height={388} fill="var(--hero-ink)" fillOpacity={0.04} stroke="var(--hero-ink)" strokeOpacity={0.5} strokeWidth={2} />
      <rect x={44} y={46} width={46} height={388} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.5} strokeWidth={2} />
      <g stroke="var(--hero-ink)" strokeOpacity={0.45} strokeWidth={2}>
        <path d="M44 108L90 108M44 372L90 372M44 240L90 240" />
      </g>
      <rect className="m-en-ribbon" x={62} y={46} width={10} height={128} fill="var(--hero-accent)" fillOpacity={0.85} />

      <g stroke="var(--hero-ink)" strokeOpacity={0.32} strokeWidth={5} strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <path key={`l${row}`} d={`M124 ${104 + row * 34}L${row === 7 ? 208 : 246} ${104 + row * 34}`} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <path key={`r${row}`} d={`M278 ${104 + row * 34}L${row === 7 ? 350 : 400} ${104 + row * 34}`} />
        ))}
      </g>
      <path d="M262 92L262 380" stroke="var(--hero-ink)" strokeOpacity={0.22} strokeWidth={1.4} />

      <circle cx={334} cy={392} r={42} fill="var(--hero-accent)" fillOpacity={0.9} />
      <circle cx={334} cy={392} r={30} fill="none" stroke="var(--hero-surface)" strokeOpacity={0.8} strokeWidth={2} />
      <path
        d="M334 368L342 384L360 386L347 398L350 416L334 407L318 416L321 398L308 386L326 384Z"
        fill="var(--hero-surface)"
        fillOpacity={0.85}
      />
    </>
  ),
};

const luzDifusa: Motif = {
  css: motion(
    "@keyframes motif-luz{0%{transform:scale(0.92);opacity:0.55}50%{transform:scale(1.06);opacity:1}" +
      "100%{transform:scale(0.92);opacity:0.55}}" +
      '[data-motif="luz-difusa"] .m-lz-ring{transform-box:view-box;transform-origin:240px 240px;' +
      "animation:motif-luz 12s ease-in-out infinite}" +
      '[data-motif="luz-difusa"] .m-lz-ring:nth-child(2){animation-delay:1.6s}' +
      '[data-motif="luz-difusa"] .m-lz-ring:nth-child(3){animation-delay:3.2s}' +
      '[data-motif="luz-difusa"] .m-lz-ring:nth-child(4){animation-delay:4.8s}',
  ),
  art: (
    <>
      <defs>
        <filter id="motif-luz-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <g className="m-lz-rings" filter="url(#motif-luz-blur)">
        <circle className="m-lz-ring" cx={240} cy={240} r={216} fill="none" stroke="var(--hero-accent)" strokeOpacity={0.3} strokeWidth={26} />
        <circle className="m-lz-ring" cx={240} cy={240} r={166} fill="none" stroke="var(--hero-accent)" strokeOpacity={0.4} strokeWidth={24} />
        <circle className="m-lz-ring" cx={240} cy={240} r={116} fill="none" stroke="var(--hero-accent)" strokeOpacity={0.5} strokeWidth={22} />
        <circle className="m-lz-ring" cx={240} cy={240} r={66} fill="none" stroke="var(--hero-accent)" strokeOpacity={0.62} strokeWidth={20} />
      </g>
      <circle cx={240} cy={240} r={191} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.28} strokeWidth={1.4} />
      <circle cx={240} cy={240} r={91} fill="none" stroke="var(--hero-ink)" strokeOpacity={0.34} strokeWidth={1.4} />
      <circle cx={240} cy={240} r={30} fill="var(--hero-accent)" fillOpacity={0.9} />
    </>
  ),
};

const ficha: Motif = {
  css: motion(
    "@keyframes motif-ficha{0%{opacity:0;transform:scale(1.5) rotate(-24deg)}" +
      "14%{opacity:1;transform:scale(1) rotate(-12deg)}70%{opacity:1;transform:scale(1) rotate(-12deg)}" +
      "88%{opacity:0;transform:scale(1) rotate(-12deg)}100%{opacity:0;transform:scale(1.5) rotate(-24deg)}}" +
      '[data-motif="ficha"] .m-fc-stamp{transform-box:view-box;transform-origin:346px 350px;' +
      "animation:motif-ficha 12s ease-out infinite}",
  ),
  art: (
    <>
      <rect x={54} y={40} width={372} height={400} fill="var(--hero-ink)" fillOpacity={0.04} stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2} />
      <rect x={54} y={40} width={372} height={64} fill="var(--hero-ink)" fillOpacity={0.07} />
      <path d="M54 104L426 104" stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2} />
      <path d="M82 72L214 72" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={7} strokeLinecap="round" />
      <path d="M330 72L398 72" stroke="var(--hero-accent)" strokeWidth={7} strokeLinecap="round" />
      <g stroke="var(--hero-ink)" strokeOpacity={0.3} strokeWidth={5} strokeLinecap="round">
        <path d="M118 146L392 146M118 182L340 182M118 218L392 218M118 254L300 254M118 290L368 290" />
      </g>
      <g fill="none" stroke="var(--hero-ink)" strokeOpacity={0.45} strokeWidth={2}>
        <rect x={82} y={134} width={22} height={22} />
        <rect x={82} y={206} width={22} height={22} />
        <rect x={82} y={278} width={22} height={22} />
      </g>
      <g stroke="var(--hero-accent)" strokeWidth={3} fill="none" strokeLinecap="round">
        <path d="M86 145L92 152L102 138M86 217L92 224L102 210" />
      </g>
      <g className="m-fc-stamp">
        <circle cx={346} cy={350} r={58} fill="none" stroke="var(--hero-accent)" strokeWidth={5} />
        <circle cx={346} cy={350} r={44} fill="none" stroke="var(--hero-accent)" strokeOpacity={0.65} strokeWidth={2} />
        <path d="M312 342L380 342M312 360L364 360" stroke="var(--hero-accent)" strokeWidth={6} strokeLinecap="round" />
      </g>
    </>
  ),
};

const entardecer: Motif = {
  css: motion(
    "@keyframes motif-entardecer{0%{transform:translateY(-46px);opacity:0.35}" +
      "35%{opacity:1}100%{transform:translateY(96px);opacity:0.35}}" +
      '[data-motif="entardecer"] .m-et-sun{transform-box:view-box;animation:motif-entardecer 14s ease-in-out infinite}',
  ),
  art: (
    <>
      <defs>
        <clipPath id="motif-entardecer-sky">
          <rect x={20} y={40} width={440} height={276} />
        </clipPath>
      </defs>
      <g stroke="var(--hero-ink)" strokeOpacity={0.14} strokeWidth={2}>
        <path d="M20 118L286 118M330 118L460 118M20 166L212 166M266 166L460 166M20 214L166 214" />
      </g>
      <g clipPath="url(#motif-entardecer-sky)">
        <g className="m-et-sun">
          <circle cx={296} cy={222} r={110} fill="var(--hero-accent)" fillOpacity={0.14} />
          <circle cx={296} cy={222} r={68} fill="var(--hero-accent)" fillOpacity={0.92} />
        </g>
      </g>
      <path d="M20 316L460 316" stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2} />
      <path d="M20 316L128 232L206 292L268 244L332 316Z" fill="var(--hero-ink)" fillOpacity={0.16} />
      <path d="M232 316L322 258L404 316Z" fill="var(--hero-ink)" fillOpacity={0.28} />
      <path d="M20 316L128 232L206 292L268 244L332 316" fill="none" stroke="var(--hero-ink)" strokeOpacity={0.6} strokeWidth={2} />
      <g stroke="var(--hero-accent)" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round">
        <path d="M258 344L334 344M276 372L316 372M248 400L344 400M282 428L310 428" />
      </g>
    </>
  ),
};

const indice: Motif = {
  css:
    '[data-motif="indice"] .m-ix-num{font-family:var(--font-display);font-size:22px;' +
    "font-variant-numeric:tabular-nums;fill:var(--hero-ink);fill-opacity:0.65}" +
    motion(
      "@keyframes motif-indice{0%{transform:translateY(0)}50%{transform:translateY(272px)}100%{transform:translateY(0)}}" +
        '[data-motif="indice"] .m-ix-marker{transform-box:view-box;animation:motif-indice 12s ease-in-out infinite}',
    ),
  art: (
    <>
      <defs>
        <pattern id="motif-indice-ticks" x={66} y={78} width={16} height={16} patternUnits="userSpaceOnUse">
          <path d="M0 8L14 8" stroke="var(--hero-ink)" strokeOpacity={0.4} strokeWidth={1.4} />
        </pattern>
      </defs>
      <rect x={66} y={78} width={16} height={320} fill="url(#motif-indice-ticks)" />
      <path d="M66 78L66 398" stroke="var(--hero-ink)" strokeOpacity={0.7} strokeWidth={2} />
      <g stroke="var(--hero-ink)" strokeOpacity={0.55} strokeWidth={2}>
        <path d="M66 78L96 78M66 158L96 158M66 238L96 238M66 318L96 318M66 398L96 398" />
      </g>
      <g stroke="var(--hero-ink)" strokeOpacity={0.5} strokeWidth={6} strokeLinecap="round">
        <path d="M136 106L262 106M136 166L224 166M136 226L286 226M136 286L206 286M136 346L248 346" />
      </g>
      <g stroke="var(--hero-ink)" strokeOpacity={0.22} strokeWidth={2} strokeDasharray="2 8" strokeLinecap="round">
        <path d="M278 106L392 106M240 166L392 166M302 226L392 226M222 286L392 286M264 346L392 346" />
      </g>
      <g className="m-ix-num" textAnchor="end">
        <text x={430} y={113}>
          12
        </text>
        <text x={430} y={173}>
          34
        </text>
        <text x={430} y={233}>
          56
        </text>
        <text x={430} y={293}>
          78
        </text>
        <text x={430} y={353}>
          90
        </text>
      </g>
      <g className="m-ix-marker">
        <path d="M50 96L74 110L50 124Z" fill="var(--hero-accent)" />
        <path d="M74 110L392 110" stroke="var(--hero-accent)" strokeOpacity={0.5} strokeWidth={2} />
      </g>
    </>
  ),
};

const MOTIFS: Record<MotifId, Motif> = {
  azulejo,
  navalha,
  placar,
  patas,
  manual,
  "grade-horaria": gradeHoraria,
  vitrine,
  "passe-partout": passePartout,
  planta,
  encadernacao,
  "luz-difusa": luzDifusa,
  ficha,
  entardecer,
  indice,
};

export function CategoryMotif({ motif, style }: { motif: MotifId; style?: CSSProperties }) {
  const { css, art } = MOTIFS[motif];
  return (
    <svg
      data-category-motif=""
      data-motif={motif}
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", width: "100%", maxWidth: "32rem", height: "auto", ...style }}
    >
      <style>{css}</style>
      {art}
    </svg>
  );
}
