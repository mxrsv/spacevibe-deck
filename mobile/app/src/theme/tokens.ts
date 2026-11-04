// Ported from the direction mock's tokens.css / mobile.css (graphite dark, Deck Light). Washes
// that the CSS mixes from `--tone` are written out as rgba here because React Native has no
// `color-mix`.

export interface Palette {
  readonly scheme: "dark" | "light";
  /** Screen ground (`--bg`). */
  readonly ground: string;
  /** Grouped-list surface (`--m-group-bg`). */
  readonly group: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly accent: string;
  /** Hairline between rows and around bars (`--hair`). */
  readonly separator: string;
  /** Quiet wash behind an icon box (`--tone` 9%). */
  readonly iconBox: string;
  readonly switchTrack: string;
  readonly switchThumb: string;
  /** Row wash for an agent that needs you (`--state-needs-you-bg`). */
  readonly needsYouBg: string;
  readonly pressed: string;
  readonly bar: string;
  readonly primary: string;
  readonly primaryText: string;
  readonly danger: string;
  /** The terminal well (`--well-bg`) and its text (`--term-fg`). */
  readonly terminalBg: string;
  readonly terminalFg: string;
  readonly status: {
    readonly needsYou: string;
    readonly working: string;
    readonly done: string;
    readonly failed: string;
    readonly idle: string;
  };
}

export const darkPalette: Palette = {
  scheme: "dark",
  ground: "#191c20",
  group: "#24272b",
  text: "#e7e8e9",
  textMuted: "#c0c1c1",
  textFaint: "#a8a8a8",
  accent: "#47bfc5",
  separator: "rgba(255,255,255,0.12)",
  iconBox: "rgba(255,255,255,0.09)",
  switchTrack: "rgba(255,255,255,0.16)",
  switchThumb: "#ffffff",
  needsYouBg: "rgba(228,194,133,0.14)",
  pressed: "rgba(0,0,0,0.08)",
  bar: "rgba(25,28,32,0.78)",
  primary: "#efe9dc",
  primaryText: "#1d1a14",
  danger: "#df7f78",
  terminalBg: "#131518",
  terminalFg: "#d6d8db",
  status: {
    needsYou: "#e4c285",
    working: "#e7e8e9",
    done: "#89ca92",
    failed: "#df7f78",
    idle: "rgba(255,255,255,0.45)",
  },
};

export const lightPalette: Palette = {
  scheme: "light",
  ground: "#f5f6f8",
  group: "#ffffff",
  text: "#272727",
  textMuted: "#464647",
  textFaint: "#585959",
  accent: "#245fca",
  separator: "rgba(0,0,0,0.12)",
  iconBox: "rgba(0,0,0,0.09)",
  switchTrack: "rgba(0,0,0,0.16)",
  switchThumb: "#ffffff",
  needsYouBg: "rgba(148,98,0,0.14)",
  pressed: "rgba(0,0,0,0.08)",
  bar: "rgba(245,246,248,0.8)",
  primary: "#2a2620",
  primaryText: "#f7f3ea",
  danger: "#b42318",
  terminalBg: "#ffffff",
  terminalFg: "#272727",
  status: {
    needsYou: "#946200",
    working: "#272727",
    done: "#067647",
    failed: "#b42318",
    idle: "rgba(0,0,0,0.45)",
  },
};

/** Touch geometry (`mobile.css`): 44 pt is the floor for anything tappable. */
export const metrics = {
  hit: 44,
  rowTwoLine: 60,
  rowOneLine: 48,
  screenInset: 16,
  radiusGroup: 12,
  radiusField: 10,
} as const;
