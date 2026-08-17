import type { ITheme } from "@xterm/xterm";
import { deriveChromeColors } from "./derive-colors";

/**
 * Publishes a resolved terminal theme as the chrome CSS custom properties
 * `:root` in `styles.css` declares (DL-2.2: switching theme must restyle all
 * chrome with zero component changes).
 *
 * It lives apart from its one caller because it has two: the app pushes vars
 * whenever settings change, and the chrome gallery pushes them when its theme
 * picker moves. A second copy of this list in the gallery would make the
 * gallery a second visual truth — the exact drift the gallery exists to expose.
 */

/**
 * Pre-JS fallbacks, one per theme-driven var. These mirror the literals in
 * `:root` so a preset missing an optional ANSI color lands on the same value
 * the stylesheet would have shown before any JS ran.
 */
const FALLBACK_BG = "#16161e";
const FALLBACK_FG = "#cbcbcb";
const FALLBACK_ACCENT = "#7aa2f7";
const FALLBACK_RED = "#f7768e";
const FALLBACK_GREEN = "#9ece6a";
const FALLBACK_YELLOW = "#e0af68";
const FALLBACK_MAGENTA = "#bb9af7";
const FALLBACK_CYAN = "#7dcfff";

export function applyThemeVars(
  rootStyle: CSSStyleDeclaration,
  theme: ITheme,
): void {
  const bg = theme.background ?? FALLBACK_BG;
  const fg = theme.foreground ?? FALLBACK_FG;
  const chrome = deriveChromeColors(bg, fg);
  rootStyle.setProperty("--bg", bg);
  rootStyle.setProperty("--fg", fg);
  rootStyle.setProperty("--accent", theme.blue ?? FALLBACK_ACCENT);
  rootStyle.setProperty("--red", theme.red ?? FALLBACK_RED);
  rootStyle.setProperty("--green", theme.green ?? FALLBACK_GREEN);
  rootStyle.setProperty("--yellow", theme.yellow ?? FALLBACK_YELLOW);
  // `:root` declares `--status-unread: var(--yellow)`, and a custom property
  // holding `var()` is substituted where it is DECLARED — so the badge keeps
  // whatever yellow `:root` resolved and cannot follow a theme published
  // further down the tree. Publishing it here, like every other derived
  // token, is a no-op on `:root` and is what lets the gallery's matrix show
  // four themes at once without one of them lying about this colour.
  rootStyle.setProperty("--status-unread", theme.yellow ?? FALLBACK_YELLOW);
  rootStyle.setProperty("--magenta", theme.magenta ?? FALLBACK_MAGENTA);
  rootStyle.setProperty("--cyan", theme.cyan ?? FALLBACK_CYAN);
  rootStyle.setProperty("--tone", chrome.tone);
  rootStyle.setProperty("--sidebar-bg", chrome.sidebarBg);
  rootStyle.setProperty("--sidebar-seam", chrome.sidebarSeam);
  rootStyle.setProperty("--chrome-1", chrome.chrome1);
  rootStyle.setProperty("--chrome-2", chrome.chrome2);
  rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
  rootStyle.setProperty("--state-hover-bg", chrome.stateHoverBg);
  rootStyle.setProperty("--input-bg", chrome.inputBg);
  rootStyle.setProperty("--hair", chrome.hair);
  rootStyle.setProperty("--hair-strong", chrome.hairStrong);
  rootStyle.setProperty("--seam-recessed", chrome.seamRecessed);
  rootStyle.setProperty("--seam-divider", chrome.seamDivider);
  rootStyle.setProperty("--seam-raised", chrome.seamRaised);
  rootStyle.setProperty("--text-primary", chrome.textPrimary);
  rootStyle.setProperty("--text-muted", chrome.textMuted);
  rootStyle.setProperty("--text-faint", chrome.textFaint);
}
