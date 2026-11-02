import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, DECK_DARK_THEME, DECK_LIGHT_THEME } from "../settings/built-in-themes";
import { UI_TOKEN_KEYS, type Theme } from "../settings/theme-schema";
import { themeFromTerminalColors } from "../settings/themes";
import { contrastRatio, deriveChromeColors } from "./derive-colors";
import { applyThemeVars } from "./theme-vars";

/**
 * `applyThemeVars` is the one place a theme becomes CSS, and its contract is
 * that it publishes EVERY theme-driven custom property — not most of them.
 *
 * The distinction only bites away from `:root`. A property declared as
 * `--status-unread: var(--yellow)` is substituted where it is declared, so a
 * token this function forgets keeps `:root`'s value forever and cannot follow
 * a theme published further down the tree. That is invisible in the app, which
 * only ever calls this on `document.documentElement`, and immediately visible
 * in the gallery's matrix, which publishes several themes at once.
 */

function recordProperties(...themes: Theme[]): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string): void {
      written.set(name, value);
    },
    removeProperty(name: string): string {
      written.delete(name);
      return "";
    },
  } as unknown as CSSStyleDeclaration;
  for (const theme of themes) applyThemeVars(style, theme);
  return written;
}

const NON_DEFAULT_THEMES = BUILT_IN_THEMES.filter(
  (theme) => theme.id !== "deck-dark" && theme.id !== "deck-light",
);

describe("applyThemeVars", () => {
  it("publishes the unread badge colour, not only the yellow behind it", () => {
    const written = recordProperties(DECK_DARK_THEME);
    expect(written.get("--yellow")).toBe(DECK_DARK_THEME.ui.yellow);
    expect(written.get("--status-unread")).toBe(DECK_DARK_THEME.ui.yellow);
  });

  it("publishes only properties the stylesheet declares a fallback for", () => {
    // A theme key is a `:root` property name without its `--`; a key with no
    // declaration there would publish a property nothing reads.
    const tokens = readFileSync("src/styles/01-tokens.css", "utf8");
    for (const key of UI_TOKEN_KEYS) {
      expect(tokens, key).toMatch(new RegExp(`--${key}:`));
    }
  });

  it.each(BUILT_IN_THEMES)("publishes every declared ui token of $id as itself", (theme) => {
    const written = recordProperties(theme);
    for (const key of UI_TOKEN_KEYS) {
      expect(written.get(`--${key}`), key).toBe(theme.ui[key]);
    }
  });

  it("publishes every derived wash and seam", () => {
    const written = recordProperties(DECK_DARK_THEME);
    const chrome = deriveChromeColors(DECK_DARK_THEME);
    for (const [name, value] of [
      ["--tone", chrome.tone],
      ["--sidebar-seam", chrome.sidebarSeam],
      ["--tab-active-bg", chrome.tabActiveBg],
      ["--state-hover-bg", chrome.stateHoverBg],
      ["--hair", chrome.hair],
      ["--hair-strong", chrome.hairStrong],
      // The seams were once published but never asserted, which left the one
      // token family whose whole point is following the theme outside the gate
      // that proves tokens follow the theme.
      ["--seam-recessed", chrome.seamRecessed],
      ["--seam-divider", chrome.seamDivider],
      ["--seam-split", chrome.seamSplit],
      ["--seam-raised", chrome.seamRaised],
    ] as const) {
      expect(written.get(name), name).toBe(value);
    }
  });

  it("leaves the preset's own values alone on the two default themes", () => {
    for (const theme of [DECK_DARK_THEME, DECK_LIGHT_THEME]) {
      const written = recordProperties(theme);
      expect(written.has("--background"), theme.id).toBe(false);
      expect(written.has("--sidebar"), theme.id).toBe(false);
    }
  });

  it("leaves the preset alone on an imported theme, which changes only the terminal", () => {
    const theme = themeFromTerminalColors("file:solarized.json", "Solarized", {
      ...DECK_DARK_THEME.terminal,
      background: "#002b36",
    });
    expect(recordProperties(theme).has("--background")).toBe(false);
  });

  it("gives the preset back when a theme switch returns to a default theme", () => {
    const [other] = NON_DEFAULT_THEMES;
    expect(recordProperties(other).get("--background")).toBe(other.ui.bg);
    const written = recordProperties(other, DECK_DARK_THEME);
    expect(
      [...written.keys()].filter((name) => /^--(ui-accent|primary|sidebar)$/.test(name)),
    ).toEqual([]);
  });

  it("keeps a primary button readable on a theme whose accent sits on its background", () => {
    const [other] = NON_DEFAULT_THEMES;
    const theme = { ...other, ui: { ...other.ui, accent: other.ui.bg } };
    const written = recordProperties(theme);
    expect(written.get("--primary-foreground")).toBe(theme.ui["text-primary"]);
  });

  it.each(NON_DEFAULT_THEMES)("keeps the preset's text readable on $id", (theme) => {
    const written = recordProperties(theme);
    const ink = (name: string): string => written.get(name) ?? "";
    for (const [text, ground, floor] of [
      ["--foreground", "--background", 4.5],
      ["--card-foreground", "--card", 4.5],
      ["--muted-foreground", "--muted", 4.5],
      ["--sidebar-foreground", "--sidebar", 4.5],
      ["--primary-foreground", "--primary", 4.5],
    ] as const) {
      expect(contrastRatio(ink(text), ink(ground)), `${text} on ${ground}`).toBeGreaterThanOrEqual(
        floor,
      );
    }
  });
});
