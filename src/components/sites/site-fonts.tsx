import {
  Archivo, DM_Mono, Fraunces, Instrument_Serif, Inter, Inter_Tight,
  Source_Serif_4, Work_Sans,
} from "next/font/google";

/**
 * The font roster for generated sites.
 *
 * It lives here rather than in the root layout because `next/font` resolves at
 * build time and loads whatever it declares: the admin panel has no reason to
 * download a client site's typeface. `FontToken` is the closed union over this
 * list, so a direction cannot name a face this layout does not load, and each
 * `variable` below is `--font-<token>` because `toStyleAttribute` emits
 * `--font-display: var(--font-<token>)`.
 *
 * It is a shared component rather than a route-group layout because the
 * public site and the internal preview live under different routes and both
 * must render the same faces.
 */
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

const FONTS = [
  fraunces, sourceSerif, instrumentSerif, archivo, interTight, inter, workSans, dmMono,
].map((font) => font.variable).join(" ");

export function SiteFonts({ children }: { children: React.ReactNode }) {
  return <div className={FONTS}>{children}</div>;
}
