import { describe, expect, it } from "vitest";
import {
  ANSI_BRIGHT_FLOOR,
  contrastRatio,
  deriveChromeColors,
  TERMINAL_CURSOR_FLOOR,
  TERMINAL_TEXT_FLOOR,
  TEXT_FAINT_FLOOR,
  TEXT_MUTED_FLOOR,
  TEXT_PRIMARY_FLOOR,
} from "../lib/derive-colors";
import { BUILT_IN_THEMES } from "./built-in-themes";
import {
  ANSI_KEYS,
  EDITOR_KEYS,
  EDITOR_SYNTAX_KEYS,
  isThemeColor,
  type EditorKey,
  TERMINAL_KEYS,
  THEME_TYPES,
  UI_TOKEN_KEYS,
  type TerminalKey,
  type Theme,
} from "./theme-schema";

const GROUPS = [
  ["ui", UI_TOKEN_KEYS],
  ["terminal", TERMINAL_KEYS],
  ["editor", EDITOR_KEYS],
] as const;

/** Every surface chrome text can sit on (DL-3.5), the selection wash included. */
function textSurfaces(theme: Theme): readonly string[] {
  const { ui } = theme;
  return [
    ui.bg,
    ui["sidebar-bg"],
    ui["chrome-1"],
    ui["chrome-2"],
    deriveChromeColors(theme).tabActiveBg,
  ];
}

const minimumOn = (ink: string, surfaces: readonly string[]): number =>
  Math.min(...surfaces.map((surface) => contrastRatio(ink, surface)));

/**
 * The ANSI slots by role. The ground-side neutral (`black` on a dark theme,
 * `white` and `brightWhite` on a light one) is a background colour for TUIs and
 * has no floor; the text-side neutral reads as body text.
 */
function ansiFloors(theme: Theme): readonly (readonly [TerminalKey, number])[] {
  const chromatic = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;
  const textSide =
    theme.type === "dark" ? (["white", "brightWhite"] as const) : (["black"] as const);
  const bright = ANSI_KEYS.filter(
    (key) => key.startsWith("bright") && key !== "brightWhite",
  ) as TerminalKey[];
  return [
    ...[...chromatic, ...textSide].map((key) => [key, TERMINAL_TEXT_FLOOR] as const),
    ...bright.map((key) => [key, ANSI_BRIGHT_FLOOR] as const),
  ];
}

/** HSV saturation, the measure DL-3.6's neutral-text ceiling is written in. */
function saturation(hex: string): number {
  const v = Number.parseInt(hex.slice(1), 16);
  const channels = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const max = Math.max(...channels);
  return max === 0 ? 0 : (max - Math.min(...channels)) / max;
}

function rgbDistance(a: string, b: string): number {
  const channels = (hex: string): number[] => {
    const v = Number.parseInt(hex.slice(1), 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  };
  const [x, y] = [channels(a), channels(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe("built-in themes", () => {
  it("ships five dark and three light themes with unique ids", () => {
    const ids = BUILT_IN_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILT_IN_THEMES.filter((theme) => theme.type === "dark")).toHaveLength(5);
    expect(BUILT_IN_THEMES.filter((theme) => theme.type === "light")).toHaveLength(3);
  });

  it.each(BUILT_IN_THEMES)("declares every colour of $id as opaque hex", (theme: Theme) => {
    expect(THEME_TYPES).toContain(theme.type);
    for (const [group, keys] of GROUPS) {
      const colors: Readonly<Record<string, string>> = theme[group];
      // Exactly the schema's keys: a missing one would leave a token on the
      // previous theme's value, a stray one is a typo nothing reads.
      expect(Object.keys(colors).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(isThemeColor(colors[key]), `${theme.id} ${group}.${key}`).toBe(true);
      }
    }
  });

  // The stage, the terminal and the editor are one surface on screen.
  it.each(BUILT_IN_THEMES)("puts $id's terminal and editor on the stage colour", (theme) => {
    expect(theme.terminal.background).toBe(theme.ui.bg);
    expect(theme.editor.background).toBe(theme.ui.bg);
    expect(theme.terminal.cursorAccent).toBe(theme.ui.bg);
  });
});

/** DL-3.5: declared values meet the floors; nothing raises them at runtime. */
describe("contrast floors", () => {
  it.each(BUILT_IN_THEMES)("holds $id's text ladder to DL-3.5 on every surface", (theme) => {
    const { ui } = theme;
    const surfaces = textSurfaces(theme);
    expect(minimumOn(ui["text-primary"], [ui["input-bg"], ...surfaces])).toBeGreaterThanOrEqual(
      TEXT_PRIMARY_FLOOR,
    );
    expect(minimumOn(ui["text-muted"], surfaces)).toBeGreaterThanOrEqual(TEXT_MUTED_FLOOR);
    expect(minimumOn(ui["text-faint"], surfaces)).toBeGreaterThanOrEqual(TEXT_FAINT_FLOOR);
  });

  it.each(BUILT_IN_THEMES)("keeps $id's text ladder ordered and distinct", (theme) => {
    const { ui } = theme;
    expect(new Set([ui["text-primary"], ui["text-muted"], ui["text-faint"]]).size).toBe(3);
    for (const surface of textSurfaces(theme)) {
      const primary = contrastRatio(ui["text-primary"], surface);
      const muted = contrastRatio(ui["text-muted"], surface);
      const faint = contrastRatio(ui["text-faint"], surface);
      expect(primary).toBeGreaterThan(muted);
      expect(muted).toBeGreaterThan(faint);
    }
  });

  it.each(BUILT_IN_THEMES)("keeps $id's terminal text and cursor legible", (theme) => {
    const { terminal } = theme;
    expect(contrastRatio(terminal.foreground, terminal.background)).toBeGreaterThanOrEqual(
      TERMINAL_TEXT_FLOOR,
    );
    expect(contrastRatio(terminal.cursor, terminal.background)).toBeGreaterThanOrEqual(
      TERMINAL_CURSOR_FLOOR,
    );
  });

  it.each(BUILT_IN_THEMES)("holds $id's ANSI colours to their floors", (theme) => {
    const { terminal } = theme;
    for (const [key, floor] of ansiFloors(theme)) {
      expect(
        contrastRatio(terminal[key], terminal.background),
        `${theme.id} ${key}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it.each(BUILT_IN_THEMES)("keeps text legible on $id's selection", (theme) => {
    const { editor, terminal } = theme;
    expect(contrastRatio(terminal.foreground, terminal.selectionBackground)).toBeGreaterThanOrEqual(
      TERMINAL_TEXT_FLOOR,
    );
    expect(contrastRatio(editor.foreground, editor.selection)).toBeGreaterThanOrEqual(
      TERMINAL_TEXT_FLOOR,
    );
  });

  // Every editor colour that draws text, on the editor's own ground.
  it.each(BUILT_IN_THEMES)("holds $id's editor text to the text floor", (theme) => {
    const { editor } = theme;
    const inks = [
      "foreground",
      "lineNumber",
      "lineNumberActive",
      ...EDITOR_SYNTAX_KEYS,
    ] as const satisfies readonly EditorKey[];
    for (const key of inks) {
      expect(
        contrastRatio(editor[key], editor.background),
        `${theme.id} editor.${key}`,
      ).toBeGreaterThanOrEqual(TERMINAL_TEXT_FLOOR);
    }
  });

  // The role inks mark state on chrome (a dot, a border, a count), so they are
  // held to WCAG's 3:1 for non-text marks; `fg` is text and gets the text floor.
  it.each(BUILT_IN_THEMES)("keeps $id's role inks visible on the stage", (theme) => {
    const { ui } = theme;
    const NON_TEXT_FLOOR = 3;
    for (const key of ["accent", "red", "green", "yellow", "magenta", "cyan"] as const) {
      expect(contrastRatio(ui[key], ui.bg), `${theme.id} ui.${key}`).toBeGreaterThanOrEqual(
        NON_TEXT_FLOOR,
      );
    }
    expect(contrastRatio(ui.fg, ui.bg)).toBeGreaterThanOrEqual(TERMINAL_TEXT_FLOOR);
  });
});

/** DL-3.6: a tinted theme tints its surfaces and accent, never its words. */
describe("neutral text", () => {
  it.each(BUILT_IN_THEMES)("keeps $id's text ladder under the saturation ceiling", (theme) => {
    for (const key of ["text-primary", "text-muted", "text-faint"] as const) {
      expect(saturation(theme.ui[key]), `${theme.id} ${key}`).toBeLessThan(0.06);
    }
  });
});

/**
 * Five dark themes are only a choice if they look different. Each pair is held
 * apart on both of the things a user tells a theme by: its ground and its
 * accent. sRGB distance, so the numbers read as "how many steps of 255".
 */
describe("the dark themes are told apart", () => {
  const MIN_GROUND_DISTANCE = 10;
  const MIN_ACCENT_DISTANCE = 24;
  const dark = BUILT_IN_THEMES.filter((theme) => theme.type === "dark");
  const pairs = dark.flatMap((a, index) => dark.slice(index + 1).map((b) => [a, b] as const));

  it("has every pair to compare", () => {
    expect(pairs).toHaveLength(10);
  });

  it.each(pairs.map(([a, b]) => [a.id, b.id, a, b] as const))(
    "%s and %s differ in ground and accent",
    (_a, _b, a, b) => {
      expect(rgbDistance(a.ui.bg, b.ui.bg)).toBeGreaterThanOrEqual(MIN_GROUND_DISTANCE);
      expect(rgbDistance(a.ui.accent, b.ui.accent)).toBeGreaterThanOrEqual(MIN_ACCENT_DISTANCE);
    },
  );
});
