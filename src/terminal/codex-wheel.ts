import type { DesktopPlatform } from '../lib/platform';

export const CODEX_PAGE_UP = '\x1b[5~';
export const CODEX_PAGE_DOWN = '\x1b[6~';

const DOM_DELTA_PIXEL = 0;
const PIXEL_PAGE_THRESHOLD = 40;

interface CodexWheelDeps {
  readonly platform: DesktopPlatform;
  readonly isCodex: () => boolean;
  /** Whether the pane currently shows the alternate screen buffer. */
  readonly isAlternateBuffer: () => boolean;
  readonly send: (data: string) => void;
}

/**
 * Windows-only compatibility path for panes running Codex, whose wheel
 * gestures were reported as not scrolling anything there.
 *
 * PageUp/PageDown are bound in exactly one Codex surface: the `pager` context
 * behind the Ctrl+T transcript overlay. Its chat screen binds no scrolling
 * action at all, and Codex enters the alternate screen only while that overlay
 * is open. So gate on the buffer the pane is actually showing, not on the
 * process label alone — on the normal buffer the gesture has to stay with
 * xterm, which scrolls the pane's own scrollback, and popup pickers must not
 * receive a stray page key either.
 *
 * Returning false stops xterm from also translating the same gesture to arrow
 * keys or an SGR mouse report. Pixel-mode touchpad events are accumulated to
 * avoid turning every tiny delta into a whole-page jump.
 */
export function createCodexWheelHandler(deps: CodexWheelDeps): (event: WheelEvent) => boolean {
  let pixelRemainder = 0;

  return (event) => {
    const modified = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
    if (
      deps.platform !== 'windows' ||
      !deps.isCodex() ||
      !deps.isAlternateBuffer() ||
      modified ||
      event.deltaY === 0
    ) {
      pixelRemainder = 0;
      return true;
    }

    let sequence: string | null = null;
    if (event.deltaMode === DOM_DELTA_PIXEL) {
      if (pixelRemainder !== 0 && Math.sign(pixelRemainder) !== Math.sign(event.deltaY)) {
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
