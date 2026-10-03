import { useEffect } from "preact/hooks";
import { getCurrentWindow } from "../host/window-host";
import { getDesktopEnvironment } from "../lib/platform";
import { titleBarOverlayColors, type FrameCornerState } from "../lib/title-bar-overlay-colors";
import type { Settings } from "../settings/settings-schema";
import { resolveTheme } from "../settings/themes";

export interface TitleBarOverlaySyncInput extends FrameCornerState {
  readonly settings: Settings;
}

/**
 * Keeps the Windows caption buttons the colour of whatever sits under them
 * (DL-18.4/18.5): the OS paints them inside the frame row, in colours only the
 * renderer knows.
 *
 * An ordinary effect keyed on the two colour strings rather than a signal
 * effect: `App` already re-renders on every signal these inputs come from, and
 * the string deps are the de-duplication — a theme or layout change that leaves
 * the corner's colours alone sends nothing. The first run is the boot send;
 * settings and custom themes are loaded before `App` renders.
 *
 * Windows only. Off Windows the colours stay `null`, so neither the derivation
 * nor the effect body does anything and no IPC is issued. Under a host with no
 * bridge (the browser preview, Tauri's native title bar) the facade is a
 * no-op.
 */
export function useTitleBarOverlaySync({ settings, ...corner }: TitleBarOverlaySyncInput): void {
  const overlay =
    getDesktopEnvironment().platform === "windows"
      ? titleBarOverlayColors(resolveTheme(settings), corner)
      : null;
  const color = overlay?.color;
  const symbolColor = overlay?.symbolColor;

  useEffect(() => {
    if (color === undefined || symbolColor === undefined) {
      return;
    }
    void getCurrentWindow().setTitleBarOverlay({ color, symbolColor });
  }, [color, symbolColor]);
}
