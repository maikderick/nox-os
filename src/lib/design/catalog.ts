import type {
  ArtDirection, MotionMoment, Palette, Radius, Rhythm, TypeSpec,
} from "./art-direction";
import type { CategoryId } from "./category";

export type CategoryDirection = {
  /** The sensory anchor. Fixed per category: it is the identity. */
  anchor: string;
  ground: ArtDirection["ground"];
  device: string;
  radius: Radius;
  motion: { moment: MotionMoment; maxMs: number };
  /** The variant space. A seed picks one of each. */
  palettes: Palette[];
  types: TypeSpec[];
  rhythms: Rhythm[];
  /** Slug of each palette, for the direction id. Same length as `palettes`. */
  paletteNames: string[];
};

export const DIRECTION_CATALOG: Record<CategoryId, CategoryDirection> = {
  food: {
    anchor: "Azulejo e cardápio do dia",
    ground: "light",
    device: "menu-leader",
    radius: "none",
    motion: { moment: "hero-image", maxMs: 200 },
    paletteNames: ["azulejo", "cal"],
    palettes: [
      { surface: "#FBFBF9", surfaceAlt: "#F2F3F0", ink: "#16181A", inkMuted: "#5A6066", line: "#DDE0DC", accent: "#1B4D8F" },
      { surface: "#F7F8F7", surfaceAlt: "#ECEEEC", ink: "#14181B", inkMuted: "#565D63", line: "#D8DCD9", accent: "#17457F" },
    ],
    types: [
      { display: "archivo", body: "work-sans", scale: "regular", displayCase: "none" },
      { display: "archivo", body: "inter", scale: "compact", displayCase: "none" },
    ],
    rhythms: ["regular", "airy"],
  },

  beauty: {
    anchor: "Espelho e latão sob luz baixa",
    ground: "dark",
    device: "facade-symmetry",
    radius: "none",
    motion: { moment: "hero-wordmark", maxMs: 200 },
    paletteNames: ["latao", "niquel"],
    palettes: [
      { surface: "#000000", surfaceAlt: "#141210", ink: "#F4F1E9", inkMuted: "#A39B8C", line: "#2A2621", accent: "#B08D57" },
      { surface: "#000000", surfaceAlt: "#121314", ink: "#F0F1F2", inkMuted: "#9BA0A5", line: "#26292B", accent: "#8FA3AD" },
    ],
    types: [
      { display: "archivo", body: "inter", scale: "compact", displayCase: "upper" },
      { display: "inter-tight", body: "inter", scale: "compact", displayCase: "upper" },
    ],
    rhythms: ["tight", "regular"],
  },

  fitness: {
    anchor: "Placar de ginásio",
    ground: "light",
    device: "tabular-numeral",
    radius: "none",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["placar", "apito"],
    palettes: [
      { surface: "#E4E4E1", surfaceAlt: "#D6D6D2", ink: "#000000", inkMuted: "#4A4A47", line: "#C2C2BD", accent: "#F2C200" },
      { surface: "#E9E9E6", surfaceAlt: "#DBDBD7", ink: "#000000", inkMuted: "#48453F", line: "#C7C7C1", accent: "#E0A800" },
    ],
    types: [
      { display: "inter-tight", body: "inter", scale: "compact", displayCase: "upper" },
      { display: "inter-tight", body: "dm-mono", scale: "compact", displayCase: "upper" },
    ],
    rhythms: ["tight", "regular"],
  },

  pet: {
    anchor: "Sala de espera clara",
    ground: "light",
    device: "soft-radius",
    radius: "lg",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["sala", "consultorio"],
    palettes: [
      { surface: "#FCFBF9", surfaceAlt: "#F4F1EC", ink: "#1C2320", inkMuted: "#5E6B64", line: "#E2DED6", accent: "#3E6B52" },
      { surface: "#FAF9F6", surfaceAlt: "#F0EEE7", ink: "#1A241E", inkMuted: "#5A6961", line: "#DEDACF", accent: "#357A5A" },
    ],
    types: [
      { display: "work-sans", body: "work-sans", scale: "regular", displayCase: "none" },
      { display: "work-sans", body: "inter", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["airy", "regular"],
  },

  auto: {
    anchor: "Manual de serviço",
    ground: "light",
    device: "spec-table",
    radius: "sm",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["manual", "oficina"],
    palettes: [
      { surface: "#F0F0EE", surfaceAlt: "#E3E3E0", ink: "#15171A", inkMuted: "#565A60", line: "#CFD0CC", accent: "#E2571E" },
      { surface: "#EAEAE7", surfaceAlt: "#DDDDD9", ink: "#141619", inkMuted: "#54585D", line: "#C8C9C4", accent: "#C94A18" },
    ],
    types: [
      { display: "inter-tight", body: "inter", scale: "compact", displayCase: "none" },
      { display: "archivo", body: "inter", scale: "compact", displayCase: "none" },
    ],
    rhythms: ["regular", "tight"],
  },

  education: {
    anchor: "Grade horária",
    ground: "light",
    device: "timetable-grid",
    radius: "sm",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["grade", "quadro"],
    palettes: [
      { surface: "#FBFAF6", surfaceAlt: "#F1EFE8", ink: "#1D2430", inkMuted: "#5A6273", line: "#DCD8CC", accent: "#35618E" },
      { surface: "#F6F5EF", surfaceAlt: "#ECEAE1", ink: "#1A212C", inkMuted: "#565E6E", line: "#D6D2C4", accent: "#2D557E" },
    ],
    types: [
      { display: "source-serif", body: "work-sans", scale: "regular", displayCase: "none" },
      { display: "source-serif", body: "inter", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["regular", "airy"],
  },

  retail: {
    anchor: "Vitrine e etiqueta",
    ground: "light",
    device: "asymmetric-grid",
    radius: "none",
    motion: { moment: "hero-image", maxMs: 200 },
    paletteNames: ["vitrine", "etiqueta"],
    palettes: [
      { surface: "#FFFFFF", surfaceAlt: "#F5F5F5", ink: "#000000", inkMuted: "#565656", line: "#E5E5E5", accent: "#000000" },
      { surface: "#FAFAFA", surfaceAlt: "#EFEFEF", ink: "#000000", inkMuted: "#525252", line: "#DFDFDF", accent: "#000000" },
    ],
    types: [
      { display: "inter-tight", body: "inter", scale: "regular", displayCase: "none" },
      { display: "archivo", body: "inter", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["airy", "regular"],
  },

  events: {
    anchor: "Passe-partout",
    ground: "light",
    device: "wide-mount",
    radius: "none",
    motion: { moment: "hero-image", maxMs: 200 },
    paletteNames: ["passe-partout", "moldura"],
    palettes: [
      { surface: "#F2F1EE", surfaceAlt: "#E7E5E1", ink: "#17171A", inkMuted: "#55555C", line: "#D8D6D1", accent: "#17171A" },
      { surface: "#ECEBE7", surfaceAlt: "#E0DED9", ink: "#151518", inkMuted: "#515158", line: "#D2D0CA", accent: "#151518" },
    ],
    types: [
      { display: "instrument-serif", body: "inter", scale: "editorial", displayCase: "none" },
      { display: "instrument-serif", body: "inter-tight", scale: "editorial", displayCase: "none" },
    ],
    rhythms: ["airy", "regular"],
  },

  realestate: {
    anchor: "Planta e cota",
    ground: "light",
    device: "dimension-line",
    radius: "none",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["planta", "cota"],
    palettes: [
      { surface: "#F5F3EF", surfaceAlt: "#EAE7E1", ink: "#22252A", inkMuted: "#5C6068", line: "#D6D2CA", accent: "#2B4A7A" },
      { surface: "#F0EEE9", surfaceAlt: "#E4E1D9", ink: "#1E2126", inkMuted: "#585C64", line: "#D0CCC2", accent: "#24406A" },
    ],
    types: [
      { display: "archivo", body: "inter", scale: "regular", displayCase: "none" },
      { display: "inter-tight", body: "inter", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["regular", "tight"],
  },

  professional: {
    anchor: "Encadernação e coluna",
    ground: "light",
    device: "bound-spine",
    radius: "none",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["encadernacao", "coluna"],
    palettes: [
      { surface: "#F7F7F4", surfaceAlt: "#EDEDE8", ink: "#1A1C21", inkMuted: "#575A61", line: "#DCDCD5", accent: "#6B2233" },
      { surface: "#F2F2EE", surfaceAlt: "#E7E7E1", ink: "#17191D", inkMuted: "#53565D", line: "#D6D6CE", accent: "#5C1D2B" },
    ],
    types: [
      { display: "source-serif", body: "source-serif", scale: "editorial", displayCase: "none" },
      { display: "source-serif", body: "inter", scale: "editorial", displayCase: "none" },
    ],
    rhythms: ["regular", "tight"],
  },

  health: {
    anchor: "Luz difusa",
    ground: "light",
    device: "large-body",
    radius: "md",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["luz", "bruma"],
    palettes: [
      { surface: "#FCFDFD", surfaceAlt: "#F1F5F6", ink: "#12212A", inkMuted: "#4C5C64", line: "#DDE5E7", accent: "#14707E" },
      { surface: "#F8FBFB", surfaceAlt: "#ECF1F2", ink: "#0F1C24", inkMuted: "#48555C", line: "#D7E0E2", accent: "#106676" },
    ],
    types: [
      { display: "work-sans", body: "work-sans", scale: "regular", displayCase: "none" },
      { display: "work-sans", body: "inter", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["airy", "regular"],
  },

  services: {
    anchor: "Ficha de serviço",
    ground: "light",
    device: "plain-list",
    radius: "sm",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["ficha", "ordem"],
    palettes: [
      { surface: "#FFFFFF", surfaceAlt: "#F6F7F8", ink: "#111418", inkMuted: "#565C63", line: "#E3E5E8", accent: "#1F4FD8" },
      { surface: "#FAFBFC", surfaceAlt: "#EFF1F3", ink: "#0F1216", inkMuted: "#525860", line: "#DDE0E3", accent: "#1A44BC" },
    ],
    types: [
      { display: "inter-tight", body: "inter", scale: "regular", displayCase: "none" },
      { display: "inter-tight", body: "work-sans", scale: "regular", displayCase: "none" },
    ],
    rhythms: ["regular", "tight"],
  },

  tourism: {
    anchor: "Pedra e âmbar ao entardecer",
    ground: "dark",
    device: "full-bleed",
    radius: "sm",
    motion: { moment: "hero-image", maxMs: 200 },
    paletteNames: ["pedra", "ambar"],
    palettes: [
      { surface: "#1F1C18", surfaceAlt: "#2A2620", ink: "#EFEAE3", inkMuted: "#A89E90", line: "#3A342C", accent: "#9A6520" },
      { surface: "#1B1815", surfaceAlt: "#26221C", ink: "#F1ECE4", inkMuted: "#A99F91", line: "#352F27", accent: "#B07A30" },
    ],
    types: [
      { display: "fraunces", body: "work-sans", scale: "editorial", displayCase: "none" },
      { display: "fraunces", body: "inter", scale: "editorial", displayCase: "none" },
    ],
    rhythms: ["airy", "regular"],
  },

  catalog: {
    anchor: "Índice",
    ground: "light",
    device: "tabular-index",
    radius: "sm",
    motion: { moment: "none", maxMs: 200 },
    paletteNames: ["indice", "sumario"],
    palettes: [
      { surface: "#FAFAF8", surfaceAlt: "#F0F0EC", ink: "#131313", inkMuted: "#55565A", line: "#E0E0DA", accent: "#0E6B5E" },
      { surface: "#F5F5F2", surfaceAlt: "#EAEAE4", ink: "#000000", inkMuted: "#515256", line: "#DADAD3", accent: "#0B5C51" },
    ],
    types: [
      { display: "inter-tight", body: "inter", scale: "compact", displayCase: "none" },
      { display: "inter-tight", body: "dm-mono", scale: "compact", displayCase: "none" },
    ],
    rhythms: ["regular", "tight"],
  },
};
