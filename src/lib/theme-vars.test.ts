import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, DECK_DARK_THEME } from "../settings/built-in-themes";
import { UI_TOKEN_KEYS, type Theme } from "../settings/theme-schema";
import { deriveChromeColors } from "./derive-colors";
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

function recordProperties(theme: Theme): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string): void {
      written.set(name, value);
    },
  } as unknown as CSSStyleDeclaration;
  applyThemeVars(style, theme);
  return written;
}

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
});
