import { signal } from "@preact/signals";
import type { ITheme } from "@xterm/xterm";
import { DARK_LUMINANCE_THRESHOLD, luminance } from "../lib/derive-colors";
import type { Settings } from "./settings-schema";
import type { ThemeColors } from "./theme-formats/theme-draft";

/**
 * The two modes Settings offers, and the only ids it ever writes.
 *
 * Every other preset in this file — the four upstream palettes, and every
 * imported file — remains valid, loadable and resolvable. What changed on
 * 2026-08-19 is which of them a user can REACH from Settings: the theme
 * gallery, the import action and the colour overrides are no longer mounted,
 * so a legacy id can only survive or be replaced, never chosen anew.
 */
export const DECK_DARK_ID = "deck-dark";
export const DECK_LIGHT_ID = "deck-light";

export type ThemeMode = "light" | "dark";

export const CANONICAL_THEME_IDS: Readonly<Record<ThemeMode, string>> = Object.freeze({
  light: DECK_LIGHT_ID,
  dark: DECK_DARK_ID,
});

export interface ThemePreset {
  id: string;
  label: string;
  theme: ThemeColors;
  /**
   * Name of the file in the themes folder this preset was parsed from. Present
   * only on imported themes — its absence is what "built-in" means, so the four
   * literals below need no field of their own and no edit when the concept
   * arrived.
   */
  fileName?: string;
}

/**
 * Themes parsed from the themes folder, published by `custom-themes-store.ts`.
 *
 * It lives here rather than beside its loader because `getPreset` is the single
 * lookup the whole app goes through — `pane.ts`, `editor-host.ts`, the search
 * bar and the status bar all call it synchronously — and a lookup that could
 * not see imported themes would resolve every one of them to the fallback.
 * Declaring the signal at the lookup keeps that one-way: the store writes, and
 * nothing here imports the store (which would be a cycle through the host
 * bridge, and would drag IPC into every test that renders a pane).
 */
export const customPresets = signal<readonly ThemePreset[]>([]);

/** Built-ins first, imports after — the gallery renders in this order. */
export function allPresets(): readonly ThemePreset[] {
  return [...THEME_PRESETS, ...customPresets.value];
}

/**
 * Every built-in `foreground` is a NEUTRAL gray, not the palette's own tinted
 * ink (2026-08-17, owner's call). Three of the four upstream palettes carry a
 * blue-violet foreground — Tokyo Night `#c0caf5` is 73% saturated, Catppuccin
 * Mocha `#cdd6f4` 64% — and because `deriveChromeColors` builds the whole
 * chrome text ladder out of `foreground`, that hue reached far past the
 * terminal: every label, path and menu item in the app was tinted blue.
 *
 * The replacements are the gray of MATCHING WCAG relative luminance, so the
 * contrast ratio each palette shipped is preserved to within 0.06 and DL-3.5's
 * floors are unaffected — only the hue is gone. The ANSI sixteen are
 * deliberately untouched: they are what makes a palette recognizable, and
 * program output is supposed to look like the theme.
 *
 * `cursor` follows `foreground` only where the palette already had them equal.
 * One Dark's `#528bff` and Catppuccin's rosewater are deliberate accents, not
 * a copy of the ink, so they stay.
 */
export const THEME_PRESETS: ThemePreset[] = [
  // The two canonical modes lead the list, and that placement is load-bearing
  // twice over: `getPreset` falls back to `THEME_PRESETS[0]`, so an id nothing
  // answers to now resolves to the same dark surface a new install gets rather
  // than to whichever palette happened to be written first.
  {
    id: DECK_DARK_ID,
    label: "Dark",
    theme: {
      // `PINNED_SIDEBAR_BG` in `derive-colors.ts` is keyed on this exact value
      // (2026-08-19): editing it here without editing the pin there retires
      // the owner's `#272d31` sidebar silently, back to a derived lift.
      background: "#17181c",
      // DL-3.6, applied at birth rather than retrofitted: the reviewed seed
      // was `#e5e7eb`, a faintly blue ink, and `deriveChromeColors` builds the
      // whole chrome text ladder out of `foreground` — so that tint would have
      // reached every label in the app. `#e7e7e7` is the gray of matching WCAG
      // luminance (14.33:1 → 14.35:1 against this background), so only the hue
      // is gone. The ANSI sixteen below keep the palette's own colour.
      foreground: "#e7e7e7",
      cursor: "#e7e7e7",
      selectionBackground: "#343842",
      black: "#202228",
      red: "#ef6b73",
      green: "#8ccf7e",
      yellow: "#e5c07b",
      blue: "#6f9cff",
      magenta: "#c792ea",
      cyan: "#63c5da",
      white: "#d8dee9",
      brightBlack: "#5d6470",
      brightRed: "#ff7a82",
      brightGreen: "#9bdd8d",
      brightYellow: "#f1d18a",
      brightBlue: "#86adff",
      brightMagenta: "#d5a3f3",
      brightCyan: "#7bd7ea",
      brightWhite: "#ffffff",
    },
  },
  {
    id: DECK_LIGHT_ID,
    label: "Light",
    theme: {
      background: "#f5f6f8",
      // Same DL-3.6 substitution as the dark mode above: the seed `#25272c`
      // became `#272727`, its luminance twin (13.82:1 → 13.82:1).
      foreground: "#272727",
      cursor: "#272727",
      selectionBackground: "#cddcff",
      black: "#25272c",
      red: "#b42318",
      green: "#067647",
      yellow: "#946200",
      blue: "#245fca",
      magenta: "#7a3fb0",
      cyan: "#087f8c",
      white: "#d6d9df",
      brightBlack: "#6b707a",
      brightRed: "#d92d20",
      brightGreen: "#079455",
      brightYellow: "#b87900",
      brightBlue: "#3578e5",
      brightMagenta: "#9656c9",
      brightCyan: "#0e94a2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    theme: {
      background: "#16161e",
      foreground: "#cbcbcb",
      cursor: "#cbcbcb",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f8",
      cursor: "#f8f8f8",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    theme: {
      background: "#282c34",
      foreground: "#b2b2b2",
      cursor: "#528bff",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    theme: {
      background: "#1e1e2e",
      foreground: "#d7d7d7",
      cursor: "#f5e0dc",
      selectionBackground: "#585b70",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
];

/**
 * Resolve a saved `themeId`, falling back to the first built-in.
 *
 * The fallback is load-bearing for imports: `themeId` persists across launches
 * but the themes folder is scanned asynchronously after boot, and a file the
 * user deleted outside the app never comes back at all. Both land here, and
 * both get a running terminal rather than an undefined theme.
 */
export function getPreset(themeId: string): ThemePreset {
  return allPresets().find((preset) => preset.id === themeId) ?? THEME_PRESETS[0];
}

/** Merge preset with color overrides — returns a new theme, no mutation. */
export function resolveTheme(settings: Settings): ITheme {
  const preset = getPreset(settings.themeId);
  const background = settings.colorOverrides.background ?? preset.theme.background;
  return {
    ...preset.theme,
    ...settings.colorOverrides,
    cursorAccent: background,
    // The decoration overview ruler (pane sets overviewRuler.width) paints a
    // separator line down its left edge. xterm defaults that color to #ffffff
    // — a hard white hairline next to the scrollbar on every dark theme.
    // Match the background so the ruler stays invisible until it has ticks.
    overviewRulerBorder: background,
  };
}

/**
 * Which of the two visible modes a stored settings object is currently
 * wearing.
 *
 * One rule for every id, canonical and legacy alike: the background the app
 * ACTUALLY resolves — `resolveTheme`'s output, not the preset's own value —
 * decides. Reading the canonical ids first would be faster and almost always
 * agree, but "almost" is the whole failure: a background override on top of
 * `deck-light` paints a dark window while the id still says light, and a
 * selector that reports the id would then contradict the screen behind it.
 * The segment describes the luminance class the user is looking at, and the
 * moment they click one it stops being a description and becomes the palette.
 *
 * The threshold is `derive-colors`' own, not a second copy: it is the line the
 * chrome derivation already draws between a light and a dark surface, and two
 * thresholds could only ever drift into a selector that disagrees with the
 * chrome it selects.
 */
export function themeModeOf(settings: Settings): ThemeMode {
  const background = resolveTheme(settings).background ?? "#000000";
  return luminance(background) < DARK_LUMINANCE_THRESHOLD ? "dark" : "light";
}

/**
 * Whether choosing a canonical mode would discard something the user cannot
 * get back from Settings.
 *
 * Two things qualify, and both are invisible on the surface that would replace
 * them: an IMPORTED theme (a file the app parsed, identified by `fileName`),
 * and a non-empty `colorOverrides` (values that keep editing whatever palette
 * is selected, including the canonical one, which is failure mode §6 of the
 * design spec). A legacy BUILT-IN with no overrides is not in this class —
 * nothing about it is unrecoverable, so asking would be ceremony.
 */
export function conversionDiscardsData(settings: Settings): boolean {
  return (
    Object.keys(settings.colorOverrides).length > 0 ||
    getPreset(settings.themeId).fileName !== undefined
  );
}
