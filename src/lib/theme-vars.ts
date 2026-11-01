import { UI_TOKEN_KEYS, type Theme } from "../settings/theme-schema";
import { deriveChromeColors } from "./derive-colors";

/**
 * Publishes a theme as the chrome CSS custom properties `:root` in
 * `styles.css` declares (DL-2.2: switching theme must restyle all chrome with
 * zero component changes). The theme's `ui` keys are the property names
 * without their `--`; the washes and seams are derived on top of them.
 *
 * It lives apart from its one caller because it has two: the app pushes vars
 * whenever settings change, and the chrome gallery pushes them when its theme
 * picker moves. A second copy of this list in the gallery would make the
 * gallery a second visual truth — the exact drift the gallery exists to expose.
 */
export function applyThemeVars(rootStyle: CSSStyleDeclaration, theme: Theme): void {
  for (const key of UI_TOKEN_KEYS) {
    rootStyle.setProperty(`--${key}`, theme.ui[key]);
  }
  // `:root` declares `--status-unread: var(--yellow)`, and a custom property
  // holding `var()` is substituted where it is DECLARED — so the badge keeps
  // whatever yellow `:root` resolved and cannot follow a theme published
  // further down the tree. Publishing it here, like every other derived
  // token, is a no-op on `:root` and is what lets the gallery's matrix show
  // several themes at once without one of them lying about this colour.
  rootStyle.setProperty("--status-unread", theme.ui.yellow);
  const chrome = deriveChromeColors(theme);
  rootStyle.setProperty("--tone", chrome.tone);
  rootStyle.setProperty("--sidebar-seam", chrome.sidebarSeam);
  rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
  rootStyle.setProperty("--state-hover-bg", chrome.stateHoverBg);
  rootStyle.setProperty("--hair", chrome.hair);
  rootStyle.setProperty("--hair-strong", chrome.hairStrong);
  rootStyle.setProperty("--seam-recessed", chrome.seamRecessed);
  rootStyle.setProperty("--seam-divider", chrome.seamDivider);
  rootStyle.setProperty("--seam-split", chrome.seamSplit);
  rootStyle.setProperty("--seam-raised", chrome.seamRaised);
}
