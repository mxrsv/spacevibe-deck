import type { ThemeColors, ThemeDef } from "./theme-data";

/** Applies a theme to the document: the appearance class plus every token as an inline variable. */
export function applyTheme(theme: ThemeDef, colors: ThemeColors = theme.colors): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(`--${key}`, value);
}

/** Back to the stylesheet's own values. */
export function clearTheme(colors: ThemeColors): void {
  for (const key of Object.keys(colors)) document.documentElement.style.removeProperty(`--${key}`);
}
