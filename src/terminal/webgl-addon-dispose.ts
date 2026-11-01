import type { WebglAddon } from "@xterm/addon-webgl";

interface BlinkHolder {
  clear(): void;
}

interface WebglAddonInternals {
  _renderer?: { _cursorBlinkStateManager?: BlinkHolder };
}

/**
 * Dispose a WebGL addon without leaking its terminal.
 *
 * addon-webgl 0.19.0 creates the renderer's `_cursorBlinkStateManager` without
 * `_register`, so `addon.dispose()` never disposes it. A focused terminal's
 * blink manager owns a 600 ms interval whose closure reaches the renderer and
 * through it the whole terminal, so the interval keeps every disposed terminal
 * (element, buffers, GL context) alive and keeps waking the renderer. Clearing
 * the holder first disposes the manager and stops its timers. Fixed upstream in
 * addon-webgl 0.20.0-beta.309, which needs xterm 6.1; delete this once a stable
 * addon-webgl compatible with our xterm registers it. The guard test in
 * `webgl-addon-dispose.test.ts` fails when that happens.
 */
export function disposeWebglAddon(addon: WebglAddon): void {
  // `_renderer` is unset when `loadAddon` threw before creating it.
  (addon as unknown as WebglAddonInternals)._renderer?._cursorBlinkStateManager?.clear();
  addon.dispose();
}
