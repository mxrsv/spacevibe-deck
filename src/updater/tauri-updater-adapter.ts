/**
 * Updater adapter.
 *
 * On Tauri this wrapped `@tauri-apps/plugin-updater`. On Electron the update
 * path is BLOCKED at Gate A: `electron-updater` goes through Squirrel.Mac,
 * which refuses an app that is not Developer ID signed and notarized, and no
 * Apple Developer identity has been bought yet.
 *
 * So this returns "no update available" rather than pretending to check.
 * That is deliberate and visible: the UI's Check for Updates simply finds
 * nothing, instead of reporting a failure the user cannot act on. The
 * single-flight guard in the main process is still wired, so the controller's
 * behaviour is unchanged when the real implementation lands.
 *
 * The file name is kept so the 44-file import swap stayed mechanical; it is
 * renamed when the Electron updater is implemented.
 */
import { relaunch } from "../host/shell-host";
import type { PendingUpdate } from "./update-controller";

export async function checkForUpdate(): Promise<PendingUpdate | null> {
  return null;
}

export function relaunchDeck(): Promise<void> {
  return relaunch();
}
