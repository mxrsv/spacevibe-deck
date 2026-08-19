/**
 * The one `SurfaceStrip` TabManager sees: the file controller's strip with
 * the browser tab composed in as the segment's last surface.
 *
 * `TabManager` deliberately knows nothing about files OR the browser — it
 * consumes the `SurfaceStrip` seam (tab-manager.ts) and `App` decides what
 * implements it, exactly how `INERT_SURFACES` → `fileController` was swapped
 * (file-explorer plan Task 5). Composing here, renderer-side, is what keeps
 * cycling (⌘⇧[/]), ⌘W routing, "last surface, not last tab" and focus
 * working for the browser without touching any R4 seam.
 *
 * Index space: `0 .. files.count()-1` are the active workspace's file tabs,
 * `files.count()` is the browser tab while it is open. The browser sits at
 * the segment's end because that is where the strip renders its chip
 * (tab-strip.tsx).
 *
 * Mutual exclusion is enforced on every path THROUGH this object (activate,
 * deactivate); paths that reach the file store directly (explorer clicks,
 * chip clicks) are backstopped by App's exclusion effect instead — the two
 * stores never import each other.
 */
import type { SurfaceStrip } from "../terminal/tab-manager";
import type { BrowserClient } from "../browser/browser-client";
import {
  activateBrowserSurface,
  browserOpen,
  browserOpenedAt,
  browserSurfaceActive,
  closeBrowser,
  deactivateBrowserSurface,
} from "../browser/browser-store";
import { UNSEQUENCED } from "../lib/open-sequence";

export interface StageSurfaceStripDeps {
  /** The file controller's own strip — delegated to for every file index. */
  readonly files: SurfaceStrip;
  readonly client: BrowserClient;
  /**
   * Fired after a browser transition this object caused, so TabManager
   * re-derives `tabViews`/status — the browser half of the file side's
   * `onSurfacesChanged` (app.tsx wires both to `notifySurfacesChanged`).
   */
  readonly onChanged: () => void;
}

export function composeSurfaceStrip(deps: StageSurfaceStripDeps): SurfaceStrip {
  const { files, client, onChanged } = deps;
  const browserSlot = (): number => (browserOpen.value ? 1 : 0);
  /** Hide the browser surface if it holds the stage; report whether it did. */
  const stepBrowserBack = (): boolean => {
    if (!browserSurfaceActive.value) {
      return false;
    }
    deactivateBrowserSurface(client);
    return true;
  };
  return {
    count: () => files.count() + browserSlot(),
    total: () => files.total() + browserSlot(),
    activeIndex: () => (browserSurfaceActive.value ? files.count() : files.activeIndex()),
    // Same delegation as every other method: file indexes go to the file
    // strip, the browser's own slot answers from its store. The merged strip
    // then places the chip by when it was opened, not by this index space —
    // which is why the browser can now sit BEFORE a file tab even though it
    // is still the last index here.
    orderKey: (index) =>
      browserOpen.value && index === files.count()
        ? browserOpenedAt.value
        : (files.orderKey?.(index) ?? UNSEQUENCED),
    activate(index) {
      if (browserOpen.value && index === files.count()) {
        if (browserSurfaceActive.value) {
          return; // already on the stage
        }
        files.deactivate();
        activateBrowserSurface();
        onChanged();
        return;
      }
      const changed = stepBrowserBack();
      files.activate(index);
      if (changed) {
        onChanged();
      }
    },
    deactivate() {
      const changed = stepBrowserBack();
      files.deactivate();
      if (changed) {
        onChanged();
      }
    },
    focus() {
      if (browserSurfaceActive.value) {
        // The native view owns its own focus; there is no DOM element here
        // that could meaningfully take it (the address bar stealing focus on
        // every settings change would be worse than a no-op).
        return;
      }
      files.focus();
    },
    async close() {
      if (browserSurfaceActive.value) {
        await closeBrowser(client);
        onChanged();
        return;
      }
      await files.close();
    },
    async save() {
      if (browserSurfaceActive.value) {
        return; // a web page has nothing Deck can save
      }
      await files.save();
    },
    applySettings(next) {
      files.applySettings(next);
    },
  };
}
