/**
 * The `apply_settings_patch` IPC handler: merges a renderer patch into the
 * settings store, re-resolves the menu keymap from the merged result, and
 * broadcasts the merge to every window.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { CHANNELS, EVENTS } from "./ipc/channels";
import { applySettingsPatch } from "./settings-merge";
import type { StoreRegistry } from "./store";

export interface SettingsIpcDeps {
  readonly stores: StoreRegistry;
  readonly windows: ReadonlyMap<string, BrowserWindow>;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
  readonly adoptMenuKeymap: (settings: unknown) => void;
}

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  ipcMain.handle(CHANNELS.applySettingsPatch, async (_event, { patch }) => {
    const merged = await applySettingsPatch(deps.stores, patch);
    // A rebind has to reach the native menu in the same turn it reaches the
    // store. Until it does, Cocoa still owns the old chord and eats it before
    // any window sees the keydown — the rebind would look applied everywhere
    // except where it matters.
    deps.adoptMenuKeymap(merged);
    // EVERY window, sender included. `settings-store.ts` states that the
    // broadcast is the one authoritative path and that the reply is used only to
    // detect failure — so excluding the sender left it rendering stale settings
    // until relaunch. Resolving the sender's label after the await was also a
    // latent throw: a window closed during the disk write has no label.
    for (const [label] of deps.windows) {
      deps.emitTo(label, EVENTS.settingsMerged, merged);
    }
    return merged;
  });
}
