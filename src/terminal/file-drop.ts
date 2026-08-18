import { getCurrentWebview, getCurrentWindow } from '../host/window-host';
import type { UnlistenFn } from '../host/bridge';

export interface FileDropHandlers {
  /** Logical coordinates (CSS px) — same origin as clientX/clientY. */
  onOver(x: number, y: number): void;
  onDrop(x: number, y: number, paths: string[]): void;
  onLeave(): void;
}

export async function installFileDrop(handlers: FileDropHandlers): Promise<UnlistenFn> {
  // The callback below runs synchronously → fetch scaleFactor up front.
  // Known limitation: if the window moves to a monitor with a different
  // scale factor mid-session, the cached value can drift.
  const scaleFactor = await getCurrentWindow().scaleFactor();
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    switch (payload.type) {
      // `enter` fires FIRST when a drag comes into the webview; treat it as `over`.
      case 'enter':
      case 'over': {
        const { x, y } = payload.position.toLogical(scaleFactor);
        handlers.onOver(x, y);
        break;
      }
      case 'drop': {
        const { x, y } = payload.position.toLogical(scaleFactor);
        handlers.onDrop(x, y, payload.paths);
        break;
      }
      case 'leave':
        handlers.onLeave();
        break;
    }
  });
}
