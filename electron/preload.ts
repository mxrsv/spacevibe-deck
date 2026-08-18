/**
 * The renderer's ONLY door to the host.
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer sees
 * exactly what is exposed below and nothing else. The shape deliberately
 * mirrors Tauri's `invoke` / `listen` pair rather than inventing a new one:
 * `src/host/*` maps onto it one for one, which is what keeps the 44 renderer
 * files a mechanical import swap instead of a rewrite.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { EVENTS, INVOKABLE_CHANNELS } from './ipc/channels';

/** Events the main process actually emits — the other half of the door. */
const LISTENABLE_EVENTS: ReadonlySet<string> = new Set<string>(Object.values(EVENTS));

contextBridge.exposeInMainWorld('__deckHost', {
  /**
   * Invoke a KNOWN channel. An unknown name is refused here rather than
   * forwarded.
   *
   * This bridge used to pass any string through, which made it a single-line
   * path from injected script to the whole host: `spawn_shell` followed by
   * `write_pty` is arbitrary command execution, `store_get` reads every store,
   * `read_file` reads the workspace. The window runs `sandbox: false`, so
   * there was no process-level backstop behind it either. Nothing legitimate
   * needs an open bridge — `src/host/*` only ever names channels from the
   * table this set is built from.
   */
  invoke: (channel: string, payload?: unknown) => {
    if (!INVOKABLE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Deck: refused an unknown host channel "${channel}"`));
    }
    return ipcRenderer.invoke(channel, payload ?? {});
  },
  listen: (event: string, handler: (payload: unknown) => void) => {
    if (!LISTENABLE_EVENTS.has(event)) {
      console.warn(`Deck: refused an unknown host event "${event}"`);
      return () => {};
    }
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(event, wrapped);
    // Returns an unlisten function, matching Tauri's `listen` contract so the
    // renderer's teardown code is unchanged.
    return () => ipcRenderer.off(event, wrapped);
  },
  /**
   * Absolute path of a dropped `File`.
   *
   * Electron removed the `File.path` augmentation, so this is the only way to
   * turn a DOM drop into a filesystem path — and it has to live in the preload,
   * because `webUtils` is unreachable from the renderer under contextIsolation.
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      // A File constructed in JS has no disk backing; Electron throws.
      return '';
    }
  },
});
