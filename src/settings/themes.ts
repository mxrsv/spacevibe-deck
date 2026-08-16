import { signal } from "@preact/signals";
import type { ITheme } from "@xterm/xterm";
import type { Settings } from "./settings-schema";
import type { ThemeColors } from "./theme-formats/theme-draft";

export interface ThemePreset {
  id: string;
  label: string;
  theme: ThemeColors;
  /**
   * Name of the file in the themes folder this preset was parsed from. Present
   * only on imported themes — its absence is what "built-in" means, so the four
   * literals below need no field of their own and no edit when the concept
   * arrived.
   */
  fileName?: string;
}

/**
 * Themes parsed from the themes folder, published by `custom-themes-store.ts`.
 *
 * It lives here rather than beside its loader because `getPreset` is the single
 * lookup the whole app goes through — `pane.ts`, `editor-host.ts`, the search
 * bar and the status bar all call it synchronously — and a lookup that could
 * not see imported themes would resolve every one of them to the fallback.
 * Declaring the signal at the lookup keeps that one-way: the store writes, and
 * nothing here imports the store (which would be a cycle through the host
 * bridge, and would drag IPC into every test that renders a pane).
 */
export const customPresets = signal<readonly ThemePreset[]>([]);

/** Built-ins first, imports after — the gallery renders in this order. */
export function allPresets(): readonly ThemePreset[] {
  return [...THEME_PRESETS, ...customPresets.value];
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    theme: {
      background: "#16161e",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      selectionBackground: "#33467c",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    theme: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    theme: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      selectionBackground: "#585b70",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
];

/**
 * Resolve a saved `themeId`, falling back to the first built-in.
 *
 * The fallback is load-bearing for imports: `themeId` persists across launches
 * but the themes folder is scanned asynchronously after boot, and a file the
 * user deleted outside the app never comes back at all. Both land here, and
 * both get a running terminal rather than an undefined theme.
 */
export function getPreset(themeId: string): ThemePreset {
  return (
    allPresets().find((preset) => preset.id === themeId) ?? THEME_PRESETS[0]
  );
}

/** Merge preset with color overrides — returns a new theme, no mutation. */
export function resolveTheme(settings: Settings): ITheme {
  const preset = getPreset(settings.themeId);
  const background =
    settings.colorOverrides.background ?? preset.theme.background;
  return {
    ...preset.theme,
    ...settings.colorOverrides,
    cursorAccent: background,
    // The decoration overview ruler (pane sets overviewRuler.width) paints a
    // separator line down its left edge. xterm defaults that color to #ffffff
    // — a hard white hairline next to the scrollbar on every dark theme.
    // Match the background so the ruler stays invisible until it has ticks.
    overviewRulerBorder: background,
  };
}
