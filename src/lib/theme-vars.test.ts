import type { ITheme } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { applyThemeVars } from "./theme-vars";

/**
 * `applyThemeVars` is the one place a theme becomes CSS, and its contract is
 * that it publishes EVERY theme-derived custom property — not most of them.
 *
 * The distinction only bites away from `:root`. A property declared as
 * `--status-unread: var(--yellow)` is substituted where it is declared, so a
 * token this function forgets keeps `:root`'s value forever and cannot follow
 * a theme published further down the tree. That is invisible in the app, which
 * only ever calls this on `document.documentElement`, and immediately visible
 * in the gallery's matrix, which publishes four themes at once.
 */

function recordProperties(theme: ITheme): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string): void {
      written.set(name, value);
    },
  } as unknown as CSSStyleDeclaration;
  applyThemeVars(style, theme);
  return written;
}

const THEME: ITheme = {
  background: "#282a36",
  foreground: "#f8f8f2",
  blue: "#bd93f9",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
};

describe("applyThemeVars", () => {
  it("publishes the unread badge colour, not only the yellow behind it", () => {
    const written = recordProperties(THEME);
    expect(written.get("--yellow")).toBe("#f1fa8c");
    expect(written.get("--status-unread")).toBe("#f1fa8c");
  });

  it("falls back for a theme missing the colour, like every other token", () => {
    const written = recordProperties({ ...THEME, yellow: undefined });
    expect(written.get("--status-unread")).toBe(written.get("--yellow"));
  });

  it("publishes every theme-driven base colour and derived chrome tone", () => {
    const written = recordProperties(THEME);
    for (const name of [
      "--bg",
      "--fg",
      "--accent",
      "--red",
      "--green",
      "--yellow",
      "--magenta",
      "--cyan",
      "--status-unread",
      "--tone",
      "--sidebar-bg",
      "--sidebar-seam",
      "--chrome-1",
      "--chrome-2",
      "--tab-active-bg",
      "--state-hover-bg",
      "--input-bg",
      "--hair",
      "--hair-strong",
      // The three seams were published but never asserted, which left the one
      // token family whose whole point is following the theme outside the gate
      // that proves tokens follow the theme.
      "--seam-recessed",
      "--seam-divider",
      "--seam-raised",
      "--text-primary",
      "--text-muted",
      "--text-faint",
    ]) {
      expect(written.has(name)).toBe(true);
    }
  });
});
