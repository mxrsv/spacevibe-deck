/**
 * The renderer's ONLY door to the host.
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer sees
 * exactly what is exposed below and nothing else. The shape deliberately
 * mirrors Tauri's `invoke` / `listen` pair rather than inventing a new one:
 * `src/host/*` maps onto it one for one, which is what keeps the 44 renderer
 * files a mechanical import swap instead of a rewrite.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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
});
