/**
 * The shape of a theme: every colour Deck paints, declared by the theme itself.
 *
 * A theme is one document (spec THM-1): metadata, a `type`, and three groups of
 * explicit colours. Nothing in a theme is derived from another of its colours,
 * and nothing is read from another theme. What stays a formula is listed under
 * "Derived, never declared" below: the hover and selection washes (DL-21) and
 * every seam and hairline (DL-2.3), so those cannot drift between themes.
 *
 * Every colour is opaque `#rrggbb`. The overlay allowlist, the hex mixer and
 * Monaco's colour map all read six hex digits, and an alpha channel behind a
 * surface is something a contrast floor cannot measure.
 *
 * Key casing follows each group's consumer, so no group needs a mapping table:
 * - `ui` keys are the design language's role names, the CSS custom properties
 *   without their `--` (DL §2). A component library's own names (`card`,
 *   `primary`, `ring`) are aliases in one CSS layer, never theme keys.
 * - `terminal` keys are xterm's `ITheme` names, so the group spreads straight
 *   into the terminal.
 * - `editor` keys follow `terminal`'s camelCase; the syntax keys are Monaco's
 *   token names with the dots folded into the case.
 *
 * Derived, never declared: `--tone` (from `type`), `--tab-active-bg` (the
 * selection wash), `--state-hover-bg`, `--tab-rest-bg`, `--hair`,
 * `--hair-strong`, `--sidebar-seam`, the four `--seam-*` tokens, and
 * `--status-unread` (the theme's `yellow`).
 */

export const THEME_TYPES = ["dark", "light"] as const;
export type ThemeType = (typeof THEME_TYPES)[number];

/**
 * The eight inks the chrome reads. They used to be injected from the terminal
 * theme (`--bg --fg --accent --red --green --yellow --magenta --cyan`); here
 * they are declared, so a status colour can be tuned for chrome surfaces
 * without moving the terminal's ANSI palette, and the other way round.
 */
export const UI_INK_KEYS = [
  "bg",
  "fg",
  "accent",
  "red",
  "green",
  "yellow",
  "magenta",
  "cyan",
] as const;

/** The background steps text sits on, besides `bg` (DL §2, DL-3.5). */
export const UI_SURFACE_KEYS = ["sidebar-bg", "chrome-1", "chrome-2", "input-bg"] as const;

/** The text ladder, held to DL-3.5's floors on every surface. */
export const UI_TEXT_KEYS = ["text-primary", "text-muted", "text-faint"] as const;

export const UI_TOKEN_KEYS = [...UI_INK_KEYS, ...UI_SURFACE_KEYS, ...UI_TEXT_KEYS] as const;
export type UiTokenKey = (typeof UI_TOKEN_KEYS)[number];

/** The terminal's own surface, ink, cursor and selection. */
export const TERMINAL_BASE_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
] as const;

/** The sixteen ANSI colours in palette order: the index is the ANSI code. */
export const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export const TERMINAL_KEYS = [...TERMINAL_BASE_KEYS, ...ANSI_KEYS] as const;
export type TerminalKey = (typeof TERMINAL_KEYS)[number];

/** The editor's own surface, ink, cursor, selection and gutter. */
export const EDITOR_SURFACE_KEYS = [
  "background",
  "foreground",
  "cursor",
  "selection",
  "lineHighlight",
  "lineNumber",
  "lineNumberActive",
  "indentGuide",
] as const;

/** One colour per Monaco token class the built-in languages emit. */
export const EDITOR_SYNTAX_KEYS = [
  "comment",
  "keyword",
  "string",
  "number",
  "type",
  "variable",
  "variablePredefined",
  "delimiter",
  "tag",
  "attributeName",
  "attributeValue",
  "regexp",
  "invalid",
] as const;

export const EDITOR_KEYS = [...EDITOR_SURFACE_KEYS, ...EDITOR_SYNTAX_KEYS] as const;
export type EditorKey = (typeof EDITOR_KEYS)[number];

export type UiTokens = Readonly<Record<UiTokenKey, string>>;
export type TerminalTokens = Readonly<Record<TerminalKey, string>>;
export type EditorTokens = Readonly<Record<EditorKey, string>>;

export interface Theme {
  /** A slug, unique across built-in and imported themes. */
  readonly id: string;
  readonly name: string;
  readonly author?: string;
  readonly version?: string;
  readonly description?: string;
  readonly type: ThemeType;
  readonly ui: UiTokens;
  readonly terminal: TerminalTokens;
  readonly editor: EditorTokens;
}

const THEME_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Whether a value is a colour a theme may declare: opaque `#rrggbb`. */
export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && THEME_COLOR.test(value);
}
