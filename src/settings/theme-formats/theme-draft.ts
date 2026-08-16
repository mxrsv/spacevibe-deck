/**
 * The shape every theme-file parser fills in, and the one gate that turns a
 * half-filled draft into a theme the app will actually run.
 *
 * Parsers deliberately do NOT validate. Each one knows its own file syntax and
 * nothing about what Deck needs, so it collects whatever colours it recognises
 * and hands the draft here. That split is what lets a fifth format arrive as
 * one file with no second copy of the "is this usable" rule.
 */
import type { ITheme } from "@xterm/xterm";

/** Exactly the theme object `ThemePreset` carries — see `../themes.ts`. */
export type ThemeColors = Required<
  Pick<ITheme, "background" | "foreground" | "cursor" | "selectionBackground">
> &
  ITheme;

/**
 * The sixteen ANSI slots in palette order, so a format that numbers its colours
 * (`palette = 4=#…`, `Ansi 4 Color`) maps onto the same names as one that spells
 * them out. Index IS the ANSI code; the order is not cosmetic.
 */
export const ANSI_SLOTS = [
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
] as const satisfies readonly (keyof ITheme)[];

export interface ThemeDraft {
  /** The name the file gave itself, or null when the format carries none. */
  label: string | null;
  colors: Partial<ThemeColors>;
}

export type ThemeParseResult =
  | { readonly ok: true; readonly label: string; readonly colors: ThemeColors }
  | { readonly ok: false; readonly reason: string };

export function emptyDraft(): ThemeDraft {
  return { label: null, colors: {} };
}

/**
 * Validate a draft and fill the two slots a terminal cannot run without.
 *
 * Background and foreground are required because every derived chrome colour in
 * `deriveChromeColors` is a function of those two (DL-2.2): a theme missing
 * either would not merely look wrong in the terminal, it would leave the
 * sidebar, seams and text tokens resolving against the previous theme's values.
 *
 * Cursor and selection are NOT required. Every format treats them as optional
 * and most collections omit at least one, so rejecting on them would refuse
 * usable themes over decoration — they fall back to values the file did supply.
 */
export function finishDraft(
  draft: ThemeDraft,
  fallbackLabel: string,
): ThemeParseResult {
  const { background, foreground } = draft.colors;
  if (background === undefined || foreground === undefined) {
    return {
      ok: false,
      reason: "no background and foreground colour in this file",
    };
  }
  const label = (draft.label ?? fallbackLabel).trim();
  return {
    ok: true,
    label: label.length > 0 ? label : fallbackLabel,
    colors: {
      ...draft.colors,
      background,
      foreground,
      cursor: draft.colors.cursor ?? foreground,
      // The selection wash is the one slot with no sensible neutral default,
      // so it borrows the palette's own bright black — the colour every
      // collection uses for "dim chrome" — before falling back to the cursor.
      selectionBackground:
        draft.colors.selectionBackground ??
        draft.colors.brightBlack ??
        draft.colors.cursor ??
        foreground,
    },
  };
}
