import { signal } from "@preact/signals";
import type { ITheme } from "@xterm/xterm";
import { DARK_LUMINANCE_THRESHOLD, luminance } from "../lib/derive-colors";
import { BUILT_IN_THEMES, DECK_DARK_THEME, DECK_LIGHT_THEME } from "./built-in-themes";
import type { Settings } from "./settings-schema";
import {
  isThemeColor,
  TERMINAL_KEYS,
  type TerminalTokens,
  type Theme,
  type ThemeType,
} from "./theme-schema";
import type { ThemeColors } from "./theme-formats/theme-draft";

/**
 * The two modes Settings offers, and the only ids it ever writes.
 *
 * The other built-ins resolve and render, but no surface offers them until the
 * Appearance area lists them. The four palettes the explicit theme model
 * retired (`tokyo-night`, `dracula`, `one-dark`, `catppuccin-mocha`) were all
 * dark, so they need no migration: like any id nothing answers to, they fall
 * back to Deck Dark.
 */
export const DECK_DARK_ID = DECK_DARK_THEME.id;
export const DECK_LIGHT_ID = DECK_LIGHT_THEME.id;

export type ThemeMode = ThemeType;

export const CANONICAL_THEME_IDS: Readonly<Record<ThemeMode, string>> = Object.freeze({
  light: DECK_LIGHT_ID,
  dark: DECK_DARK_ID,
});

/** A theme parsed from a file in the themes folder. */
export interface ImportedTheme {
  readonly theme: Theme;
  /** The file it came from. Its presence is what "imported" means. */
  readonly fileName: string;
}

/**
 * Themes parsed from the themes folder, published by `custom-themes-store.ts`.
 *
 * It lives here rather than beside its loader because `getTheme` is the single
 * lookup the whole app goes through — `pane.ts`, `editor-host.ts`, the search
 * bar and the status bar all call it synchronously — and a lookup that could
 * not see imported themes would resolve every one of them to the fallback.
 * Declaring the signal at the lookup keeps that one-way: the store writes, and
 * nothing here imports the store (which would be a cycle through the host
 * bridge, and would drag IPC into every test that renders a pane).
 */
export const customThemes = signal<readonly ImportedTheme[]>([]);

/** Built-ins first, imports after — the gallery renders in this order. */
export function allThemes(): readonly Theme[] {
  return [...BUILT_IN_THEMES, ...customThemes.value.map((entry) => entry.theme)];
}

/**
 * Resolve a saved `themeId`, falling back to Deck Dark.
 *
 * The fallback is load-bearing for imports: `themeId` persists across launches
 * but the themes folder is scanned asynchronously after boot, and a file the
 * user deleted outside the app never comes back at all. Both land here, and
 * both get a running terminal rather than an undefined theme.
 */
export function getTheme(themeId: string): Theme {
  return allThemes().find((theme) => theme.id === themeId) ?? DECK_DARK_THEME;
}

/** The theme a stored settings object is wearing. */
export function activeTheme(settings: Settings): Theme {
  return getTheme(settings.themeId);
}

/** The active theme's terminal group, as xterm reads it. */
export function resolveTheme(settings: Settings): ITheme {
  const { terminal } = activeTheme(settings);
  return {
    ...terminal,
    // The decoration overview ruler (pane sets overviewRuler.width) paints a
    // separator line down its left edge. xterm defaults that color to #ffffff
    // — a hard white hairline next to the scrollbar on every dark theme.
    // Match the background so the ruler stays invisible until it has ticks.
    overviewRulerBorder: terminal.background,
  };
}

/**
 * A theme built from a terminal palette in a legacy theme file.
 *
 * Such a file knows only terminal colours, so it replaces only the terminal:
 * the chrome and the editor are the built-in of its type, Deck Dark or Deck
 * Light, typed by the file's background. A slot the file leaves out, or holds
 * in a form a theme cannot declare, keeps that built-in's value.
 */
export function themeFromTerminalColors(id: string, name: string, colors: ThemeColors): Theme {
  const base =
    luminance(colors.background) < DARK_LUMINANCE_THRESHOLD ? DECK_DARK_THEME : DECK_LIGHT_THEME;
  const terminal = Object.fromEntries(
    TERMINAL_KEYS.map((key) => {
      const value = colors[key];
      return [key, isThemeColor(value) ? value : base.terminal[key]];
    }),
  ) as TerminalTokens;
  return {
    ...base,
    id,
    name,
    // The cursor's glyph is drawn on the terminal's own ground, as it always was.
    terminal: { ...terminal, cursorAccent: terminal.background },
  };
}

/** Which of the two visible modes a stored settings object is currently wearing. */
export function themeModeOf(settings: Settings): ThemeMode {
  return activeTheme(settings).type;
}

/**
 * Whether choosing a canonical mode would discard something the user cannot
 * get back from Settings: an IMPORTED theme's selection, which no surface can
 * pick again. A built-in, or a retired id, is not in this class — nothing about
 * it is unrecoverable, so asking would be ceremony.
 */
export function conversionDiscardsData(settings: Settings): boolean {
  return customThemes.value.some((entry) => entry.theme.id === settings.themeId);
}
