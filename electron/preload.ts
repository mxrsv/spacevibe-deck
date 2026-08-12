/**
 * The renderer's ONLY door to the host.
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer sees
 * exactly what is exposed below and nothing else. The shape deliberately
 * mirrors Tauri's `invoke` / `listen` pair rather than inventing a new one:
 * `src/host/*` maps onto it one for one, which is what keeps the 44 renderer
 * files a mechanical import swap instead of a rewrite.
 */
import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from "electron";

contextBridge.exposeInMainWorld("__deckHost", {
  invoke: (channel: string, payload?: unknown) =>
    ipcRenderer.invoke(channel, payload ?? {}),
  listen: (event: string, handler: (payload: unknown) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) =>
      handler(payload);
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
      return "";
    }
  },
});
