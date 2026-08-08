import type { Settings } from "../settings/settings-schema";
import { resolveTheme } from "../settings/themes";
import { paneUsesBackgroundImage } from "./pane-background";

export interface NativeTerminalAppearance {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly selectionBackground: string;
  readonly normal: readonly string[];
  readonly bright: readonly string[];
  readonly opacity: number;
  readonly scrollback: number;
}
const NORMAL_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const BRIGHT_KEYS = ["brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;

export function nativeTerminalAppearance(settings: Settings): NativeTerminalAppearance {
  const theme = resolveTheme(settings);
  const presetFallback = "#c0caf5";
  return {
    fontFamily: settings.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, ""),
    // xterm uses CSS pixels; Alacritty uses points. Both are logical units at 96 DPI.
    fontSize: Number((settings.fontSize * 0.75).toFixed(2)),
    background: theme.background ?? "#16161e",
    foreground: theme.foreground ?? presetFallback,
    cursor: theme.cursor ?? theme.foreground ?? presetFallback,
    selectionBackground: theme.selectionBackground ?? "#33467c",
    normal: NORMAL_KEYS.map((key) => theme[key] ?? presetFallback),
    bright: BRIGHT_KEYS.map((key) => theme[key] ?? presetFallback),
    opacity: paneUsesBackgroundImage(settings, "alacritty")
      ? settings.terminalBackground.nativeOpacity
      : 1,
    scrollback: settings.scrollback,
  };
}
