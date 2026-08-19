/**
 * Window handle — the replacement for `@tauri-apps/api/window` and
 * `@tauri-apps/api/webview`.
 *
 * Only the methods the renderer actually uses are here: `close`, `isFocused`,
 * `onFocusChanged`, `scaleFactor`, `toggleMaximize`, and the webview's
 * `onDragDropEvent`. Anything else would be dead surface.
 *
 * Note there is deliberately NO close-requested subscription: the main process
 * owns that, which is what keeps a wedged renderer from making quit
 * unanswerable.
 */
import { invoke, type UnlistenFn } from "./bridge";

/**
 * A drop position in PHYSICAL pixels, with the same `toLogical` conversion
 * Tauri's `PhysicalPosition` offered.
 *
 * The conversion is not decoration: the renderer hit-tests against CSS pixels,
 * so on a 2x display a physical coordinate would land at twice the intended
 * position and drop a folder onto the wrong pane.
 */
export class PhysicalPosition {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  toLogical(scaleFactor: number): { x: number; y: number } {
    return { x: this.x / scaleFactor, y: this.y / scaleFactor };
  }
}

export type DragDropPayload =
  | { readonly type: "enter" | "over"; readonly position: PhysicalPosition }
  | {
      readonly type: "drop";
      readonly paths: string[];
      readonly position: PhysicalPosition;
    }
  | { readonly type: "leave" };

export interface DragDropEvent {
  readonly payload: DragDropPayload;
}

/** The preload bridge, for the one thing that is not invoke/listen. */
function hostBridge(): { getPathForFile?: (file: File) => string } | undefined {
  return (globalThis as { __deckHost?: { getPathForFile?: (file: File) => string } }).__deckHost;
}

class DeckWindow {
  close(): Promise<void> {
    return invoke("window_close");
  }

  toggleMaximize(): Promise<void> {
    return invoke("window_toggle_maximize");
  }

  async isFocused(): Promise<boolean> {
    return globalThis.document?.hasFocus() ?? true;
  }

  /**
   * Display scale factor, for converting physical drop coordinates to CSS px.
   *
   * Read from the renderer's own `devicePixelRatio`, NOT from the main process:
   * `webContents.getZoomFactor()` is the user's zoom level and returns 1 on a
   * 2x Retina display at default zoom, which silently turned the conversion
   * into a no-op and landed every drop at double the intended position.
   */
  async scaleFactor(): Promise<number> {
    return globalThis.devicePixelRatio || 1;
  }

  /**
   * Window focus changes.
   *
   * Uses the renderer's own focus/blur events rather than an IPC event: the
   * page is only ever inside one window, so `window.onfocus` IS that window's
   * focus. Wiring it through the main process would add a hop and a chance to
   * miss the first transition.
   *
   * This drives whether native notifications fire, so losing it means an agent
   * finishing in an unfocused window notifies nobody.
   */
  async onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn> {
    const onFocus = () => handler({ payload: true });
    const onBlur = () => handler({ payload: false });
    globalThis.addEventListener("focus", onFocus);
    globalThis.addEventListener("blur", onBlur);
    return () => {
      globalThis.removeEventListener("focus", onFocus);
      globalThis.removeEventListener("blur", onBlur);
    };
  }

  /**
   * File drag-and-drop over the window.
   *
   * Tauri emitted this as a webview event from the host; Electron has no
   * equivalent, so it is built from the renderer's own DOM drag events. Paths
   * come from the preload's `getPathForFile` — Electron removed `File.path`,
   * and `webUtils` is unreachable from the renderer under contextIsolation.
   *
   * `preventDefault` on dragover is mandatory: without it the browser refuses
   * the drop and no `drop` event fires at all.
   */
  async onDragDropEvent(handler: (event: DragDropEvent) => void): Promise<UnlistenFn> {
    const scale = globalThis.devicePixelRatio || 1;
    // Coordinates are handed back in PHYSICAL pixels so `toLogical` stays
    // meaningful for callers that were written against Tauri's shape.
    const at = (event: DragEvent) =>
      new PhysicalPosition(event.clientX * scale, event.clientY * scale);

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      handler({ payload: { type: "over", position: at(event) } });
    };
    const onDragLeave = (event: DragEvent) => {
      // Fires for every child element the pointer crosses; only the one that
      // actually leaves the window counts, or the drop target flickers off.
      if (event.relatedTarget === null) {
        handler({ payload: { type: "leave" } });
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const files = [...(event.dataTransfer?.files ?? [])];
      const paths = files
        .map((file) => hostBridge()?.getPathForFile?.(file) ?? "")
        .filter((path) => path.length > 0);
      handler({ payload: { type: "drop", paths, position: at(event) } });
    };

    globalThis.addEventListener("dragover", onDragOver);
    globalThis.addEventListener("dragleave", onDragLeave);
    globalThis.addEventListener("drop", onDrop);
    return () => {
      globalThis.removeEventListener("dragover", onDragOver);
      globalThis.removeEventListener("dragleave", onDragLeave);
      globalThis.removeEventListener("drop", onDrop);
    };
  }
}

const current = new DeckWindow();

export function getCurrentWindow(): DeckWindow {
  return current;
}

export function getCurrentWebview(): DeckWindow {
  return current;
}

/**
 * This window's label, as the main process assigns it (`labelOf(event)`).
 *
 * No prior renderer accessor existed: `windowBootMode` returns a `BootMode`
 * with no label, and every other module that needed one let the main process
 * derive it per-request from the sender. Session restore needs to name this
 * window's own `window:<label>` journal key from the renderer side, so this
 * is the smallest possible channel for that (`electron/ipc/channels.ts`'s
 * `windowLabel`).
 */
export function currentWindowLabel(): Promise<string> {
  return invoke<string>("window_label");
}
