import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { PendingUpdate } from "./update-controller";

export async function checkForUpdate(): Promise<PendingUpdate | null> {
  const update = await check();
  if (update === null) {
    return null;
  }
  return Object.freeze({
    currentVersion: update.currentVersion,
    version: update.version,
    notes: update.body ?? null,
    download: () => update.download(),
    install: () => update.install(),
  });
}

export function relaunchDeck(): Promise<void> {
  return relaunch();
}
