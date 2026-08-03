import type { DesktopPlatform } from "../lib/platform";

export const CODEX_PAGE_UP = "\x1b[5~";
export const CODEX_PAGE_DOWN = "\x1b[6~";

const DOM_DELTA_PIXEL = 0;
const PIXEL_PAGE_THRESHOLD = 40;

interface CodexWheelDeps {
  readonly platform: DesktopPlatform;
  readonly isCodex: () => boolean;
  readonly send: (data: string) => void;
}

/**
 * Codex's Windows TUI uses the alternate screen but does not consistently
 * consume xterm/WebView2 mouse-wheel reports. Keyboard PageUp/PageDown still
 * drive its internal transcript pager, so translate an unmodified wheel only
 * while the pane is explicitly classified as Codex.
 *
 * Returning false stops xterm from also translating the same gesture to arrow
 * keys or an SGR mouse report. Pixel-mode touchpad events are accumulated to
 * avoid turning every tiny delta into a whole-page jump.
 */
export function createCodexWheelHandler(
  deps: CodexWheelDeps,
): (event: WheelEvent) => boolean {
  let pixelRemainder = 0;

  return (event) => {
    const modified =
      event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
    if (
      deps.platform !== "windows" ||
      !deps.isCodex() ||
      modified ||
      event.deltaY === 0
    ) {
      pixelRemainder = 0;
      return true;
    }

    let sequence: string | null = null;
    if (event.deltaMode === DOM_DELTA_PIXEL) {
      if (
        pixelRemainder !== 0 &&
        Math.sign(pixelRemainder) !== Math.sign(event.deltaY)
      ) {
        pixelRemainder = 0;
      }
      pixelRemainder += event.deltaY;
      if (Math.abs(pixelRemainder) >= PIXEL_PAGE_THRESHOLD) {
        sequence = pixelRemainder < 0 ? CODEX_PAGE_UP : CODEX_PAGE_DOWN;
        pixelRemainder = 0;
      }
    } else {
      pixelRemainder = 0;
      sequence = event.deltaY < 0 ? CODEX_PAGE_UP : CODEX_PAGE_DOWN;
    }

    // xterm registers a second wheel listener while a TUI has mouse tracking
    // enabled. Stop it on this same event or the gesture can be delivered twice.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (sequence !== null) {
      deps.send(sequence);
    }
    return false;
  };
}
