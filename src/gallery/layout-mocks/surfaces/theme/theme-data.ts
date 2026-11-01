import { oklch } from "./theme-color";

export type Appearance = "dark" | "light";

/** Every token a theme declares: the shadcn preset roles plus the terminal inks. */
export const TOKEN_GROUPS = [
  {
    id: "surface",
    label: "Surface",
    keys: ["background", "card", "popover", "sidebar", "muted", "secondary"],
  },
  {
    id: "text",
    label: "Text",
    keys: [
      "foreground",
      "card-foreground",
      "popover-foreground",
      "sidebar-foreground",
      "muted-foreground",
      "secondary-foreground",
    ],
  },
  {
    id: "accent",
    label: "Accent",
    keys: [
      "primary",
      "primary-foreground",
      "accent",
      "accent-foreground",
      "ring",
      "sidebar-primary",
      "sidebar-primary-foreground",
      "sidebar-accent",
      "sidebar-accent-foreground",
      "sidebar-ring",
    ],
  },
  { id: "border", label: "Border", keys: ["border", "input", "sidebar-border"] },
  {
    id: "state",
    label: "State",
    keys: ["destructive", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"],
  },
  {
    id: "terminal",
    label: "Terminal",
    keys: [
      "term-bg",
      "term-fg",
      "term-dim",
      "term-accent",
      "term-ok",
      "term-err",
      "term-warn",
      "term-info",
    ],
  },
] as const;

export type TokenKey = (typeof TOKEN_GROUPS)[number]["keys"][number];
export type ThemeColors = Readonly<Record<TokenKey, string>>;

export interface ThemeDef {
  readonly id: string;
  readonly label: string;
  readonly appearance: Appearance;
  readonly colors: ThemeColors;
}

/** The two colours a theme is authored from; the result is a full, explicit token map. */
export interface ThemeSeed {
  readonly id: string;
  readonly label: string;
  readonly appearance: Appearance;
  /** Canvas hue (0-360) and chroma (0-0.04): the tint of every surface. */
  readonly hue: number;
  readonly chroma: number;
  /** Accent hue and chroma. */
  readonly accentHue: number;
  readonly accentChroma: number;
}

/** Authoring helper only: expands two colours into every token, stored as explicit values. */
export function makeTheme(seed: ThemeSeed): ThemeDef {
  const { appearance, hue: h, chroma: c, accentHue: ah, accentChroma: ac } = seed;
  const dark = appearance === "dark";
  const surface = (l: number) => oklch(l, c, h);
  const ink = (l: number) => oklch(l, c * 0.4, h);
  const accent = oklch(dark ? 0.76 : 0.5, ac, ah);
  const onAccent = oklch(dark ? 0.17 : 0.985, 0.01, ah);
  const ring = oklch(dark ? 0.66 : 0.6, ac * 0.8, ah);
  const border = surface(dark ? 0.3 : 0.88);
  const hover = surface(dark ? 0.27 : 0.93);
  const fg = ink(dark ? 0.93 : 0.22);
  const sidebar = surface(dark ? 0.18 : 0.96);
  const chart = (i: number) => oklch(dark ? 0.74 : 0.55, ac * 0.8, (ah + i * 55) % 360);
  const colors: ThemeColors = {
    background: surface(dark ? 0.16 : 0.985),
    card: surface(dark ? 0.2 : 0.995),
    popover: surface(dark ? 0.22 : 0.995),
    sidebar,
    muted: surface(dark ? 0.24 : 0.95),
    secondary: surface(dark ? 0.26 : 0.94),
    foreground: fg,
    "card-foreground": fg,
    "popover-foreground": fg,
    "sidebar-foreground": fg,
    "muted-foreground": ink(dark ? 0.72 : 0.48),
    "secondary-foreground": fg,
    primary: accent,
    "primary-foreground": onAccent,
    accent: hover,
    "accent-foreground": fg,
    ring,
    "sidebar-primary": accent,
    "sidebar-primary-foreground": onAccent,
    "sidebar-accent": hover,
    "sidebar-accent-foreground": fg,
    "sidebar-ring": ring,
    border,
    input: surface(dark ? 0.33 : 0.86),
    "sidebar-border": border,
    destructive: oklch(dark ? 0.68 : 0.55, 0.2, 26),
    "chart-1": chart(0),
    "chart-2": chart(1),
    "chart-3": chart(2),
    "chart-4": chart(3),
    "chart-5": chart(4),
    "term-bg": surface(dark ? 0.14 : 0.985),
    "term-fg": ink(dark ? 0.9 : 0.24),
    "term-dim": ink(dark ? 0.68 : 0.47),
    "term-accent": oklch(dark ? 0.76 : 0.5, 0.13, ah),
    "term-ok": oklch(dark ? 0.78 : 0.47, 0.13, 150),
    "term-err": oklch(dark ? 0.72 : 0.5, 0.17, 25),
    "term-warn": oklch(dark ? 0.82 : 0.52, 0.12, dark ? 85 : 75),
    "term-info": oklch(dark ? 0.76 : 0.48, 0.1, 245),
  };
  return { id: seed.id, label: seed.label, appearance, colors };
}

/** The candidate built-in set: five dark, three light, each a different mood. */
export const THEMES: readonly ThemeDef[] = [
  makeTheme({
    id: "deck-dark",
    label: "Deck Dark",
    appearance: "dark",
    hue: 56,
    chroma: 0.004,
    accentHue: 264,
    accentChroma: 0.19,
  }),
  makeTheme({
    id: "graphite",
    label: "Graphite",
    appearance: "dark",
    hue: 260,
    chroma: 0.006,
    accentHue: 200,
    accentChroma: 0.12,
  }),
  makeTheme({
    id: "midnight",
    label: "Midnight",
    appearance: "dark",
    hue: 262,
    chroma: 0.03,
    accentHue: 250,
    accentChroma: 0.17,
  }),
  makeTheme({
    id: "forest",
    label: "Forest",
    appearance: "dark",
    hue: 160,
    chroma: 0.02,
    accentHue: 150,
    accentChroma: 0.15,
  }),
  makeTheme({
    id: "dusk",
    label: "Dusk",
    appearance: "dark",
    hue: 300,
    chroma: 0.025,
    accentHue: 330,
    accentChroma: 0.18,
  }),
  makeTheme({
    id: "deck-light",
    label: "Deck Light",
    appearance: "light",
    hue: 56,
    chroma: 0.004,
    accentHue: 264,
    accentChroma: 0.2,
  }),
  makeTheme({
    id: "paper",
    label: "Paper",
    appearance: "light",
    hue: 80,
    chroma: 0.012,
    accentHue: 45,
    accentChroma: 0.15,
  }),
  makeTheme({
    id: "mist",
    label: "Mist",
    appearance: "light",
    hue: 230,
    chroma: 0.012,
    accentHue: 200,
    accentChroma: 0.13,
  }),
];

export function themeById(id: string): ThemeDef {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
