import { computed, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { applyTheme, clearTheme } from "./theme-apply";
import { THEMES, type Appearance, type ThemeDef } from "./theme-data";

export type Mode = "system" | Appearance;

const SCHEME = "(prefers-color-scheme: dark)";

/** App-level appearance state, so it survives opening and closing Settings. */
const modeParam = new URLSearchParams(window.location.search).get("mode");
export const mode = signal<Mode>(
  modeParam === "light" || modeParam === "dark" ? modeParam : "system",
);
export const slots = signal<Readonly<Record<Appearance, string>>>({
  light: "deck-light",
  dark: "deck-dark",
});
export const customThemes = signal<readonly ThemeDef[]>([]);
/** The theme under the pointer in the gallery; the shell shows it until the pointer leaves. */
export const previewId = signal<string | null>(null);
const systemDark = signal(window.matchMedia(SCHEME).matches);

export const allThemes = computed(() => [...THEMES, ...customThemes.value]);
export const themeById = (id: string): ThemeDef =>
  allThemes.value.find((theme) => theme.id === id) ?? THEMES[0];

const active = computed<Appearance>(() =>
  mode.value === "system" ? (systemDark.value ? "dark" : "light") : mode.value,
);
export const selectedTheme = computed(() => themeById(slots.value[active.value]));
const shownTheme = computed(() =>
  previewId.value ? themeById(previewId.value) : selectedTheme.value,
);

export function pickTheme(theme: ThemeDef): void {
  slots.value = { ...slots.value, [theme.appearance]: theme.id };
  if (mode.value !== "system") mode.value = theme.appearance;
}

export function addCustomTheme(theme: ThemeDef): void {
  customThemes.value = [...customThemes.value, theme];
  pickTheme(theme);
}

/** Mounted once at the app root: follows the OS and applies the shown theme to the document. */
export function useThemeEngine(): void {
  useEffect(() => {
    const query = window.matchMedia(SCHEME);
    const onChange = () => (systemDark.value = query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const stop = shownTheme.subscribe((theme) => applyTheme(theme));
    return () => {
      stop();
      clearTheme(THEMES[0].colors);
      root.style.colorScheme = "";
      root.classList.toggle("dark", wasDark);
    };
  }, []);
}
