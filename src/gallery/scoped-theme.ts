import { applyThemeVars } from "../lib/theme-vars";
import type { Theme } from "../settings/theme-schema";

/**
 * Publishes a theme on one gallery cell. Deck Dark and Deck Light publish no preset tokens, so a
 * cell would inherit whatever palette the gallery's root shows; the classes give it the preset's own.
 */
export function applyScopedTheme(node: HTMLElement, theme: Theme): void {
  applyThemeVars(node.style, theme);
  // `01-tokens.css` re-declares its `var()`-holding recipe tokens here, against this cell's palette.
  node.dataset.themeScope = theme.id;
  node.classList.toggle("dark", theme.type === "dark");
  node.classList.toggle("preset-light", theme.type === "light");
}
