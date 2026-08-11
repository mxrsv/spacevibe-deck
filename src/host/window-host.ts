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
import { invoke, listen, type UnlistenFn } from "./bridge";

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

/** Wire form: a plain object survives IPC, a class instance does not. */
interface RawDragDropPayload {
  readonly type: "enter" | "over" | "drop" | "leave";
  readonly paths?: string[];
  readonly position?: { x: number; y: number };
}

function reviveDragDrop(raw: RawDragDropPayload): DragDropPayload {
  const position = new PhysicalPosition(
    raw.position?.x ?? 0,
    raw.position?.y ?? 0,
  );
  switch (raw.type) {
    case "drop":
      return { type: "drop", paths: raw.paths ?? [], position };
    case "leave":
      return { type: "leave" };
    default:
      return { type: raw.type, position };
  }
}

class DeckWindow {
  close(): Promise<void> {
    return invoke("window_close");
  }

  toggleMaximize(): Promise<void> {
    return invoke("window_toggle_maximize");
  }

  isFocused(): Promise<boolean> {
    return invoke<boolean>("window_is_focused");
  }

  scaleFactor(): Promise<number> {
    return invoke<number>("window_scale_factor");
  }

  onFocusChanged(
    handler: (event: { payload: boolean }) => void,
  ): Promise<UnlistenFn> {
    return listen<boolean>("window:focus-changed", handler);
  }

  onDragDropEvent(
    handler: (event: DragDropEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<RawDragDropPayload>("window:drag-drop", (event) =>
      handler({ payload: reviveDragDrop(event.payload) }),
    );
  }
}

const current = new DeckWindow();

export function getCurrentWindow(): DeckWindow {
  return current;
}

export function getCurrentWebview(): DeckWindow {
  return current;
}
