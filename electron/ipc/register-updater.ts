/**
 * Update IPC handlers.
 *
 * The single-flight below is unchanged: it is what stops peer windows each
 * running the automatic startup check, and the renderer's controller is built
 * around it. What used to be missing is everything else — the check itself was
 * a stub, so "Check for Updates" on this host answered "SpaceVibe Deck is up to
 * date" whether or not an update existed. The lifecycle now lives in
 * `../updater/updater.ts`; this file only supplies it with the host.
 *
 * Gate A is still open — `electron-updater` cannot be proven end to end on
 * macOS until a Developer ID identity signs and notarizes a build, because
 * Squirrel.Mac refuses an unsigned app. Unpackaged and unsigned runs therefore
 * answer `unsupported`, which is an honest answer rather than a false one.
 */
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import { CHANNELS } from "./channels";
import {
  createUpdateLifecycle,
  type AutoUpdaterLike,
} from "../updater/updater";
import { UpdateFlight } from "../updater/update-flight";

export interface UpdaterDependencies {
  /** The window a request came from, as every other register module names it. */
  labelOf(event: IpcMainInvokeEvent): string;
  /**
   * Kill the PTYs and flush the stores, in that order — `confirm_quit`'s own
   * sequence. The install exit does not reach main's quit census (see
   * `isInstalling`), so nothing else on that path does this work.
   */
  prepareForInstall(): Promise<void>;
}

export interface UpdaterHandle {
  /**
   * Release the update-check flight this window may be holding.
   *
   * A window that dies between `begin_update_check` and `end_update_check`
   * never sends the release, and every other window is then told another
   * check is in progress for the life of the process.
   */
  forgetWindow(label: string): void;
  /**
   * True while `quitAndInstall` is taking the app down.
   *
   * `quitAndInstall` closes every window and only then emits `before-quit`, so
   * main's close and quit censuses would each raise a prompt the user has
   * already answered — the renderer runs the busy-pane confirmation itself
   * before asking for the install — and the install would deadlock behind them.
   */
  isInstalling(): boolean;
}

export function registerUpdater(deps: UpdaterDependencies): UpdaterHandle {
  const flight = new UpdateFlight();
  ipcMain.handle(CHANNELS.beginUpdateCheck, (event) =>
    flight.tryBegin(deps.labelOf(event)),
  );
  ipcMain.handle(CHANNELS.endUpdateCheck, (event) => {
    const label = deps.labelOf(event);
    if (!flight.finish(label)) {
      // Same answer the Tauri command gives, so the renderer's controller sees
      // one behaviour on both hosts: a stale release from a window that no
      // longer holds the flight must not free a live one.
      throw new Error(`Window ${label} does not hold the update check`);
    }
  });

  const lifecycle = createUpdateLifecycle({
    loadUpdater: () => {
      // GitHub provider, no token: `mxrsv/spacevibe-deck` is public. Named
      // here rather than left to the packaged `app-update.yml` because the
      // production packaging config does not exist yet, and the lifecycle is
      // worth pointing at a real feed without it. `electron-updater` reads
      // `latest-mac.yml` / `latest.yml`; Tauri's `latest.json` is a separate
      // manifest with separate trust material and is never touched here.
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "mxrsv",
        repo: "spacevibe-deck",
      });
      return autoUpdater as unknown as AutoUpdaterLike;
    },
    // A dev run has no bundle to replace and no signature to verify.
    supported: app.isPackaged,
    currentVersion: app.getVersion(),
    prepareForInstall: () => deps.prepareForInstall(),
    report: (message, error) => console.error(`Deck: ${message}`, error),
  });

  ipcMain.handle(CHANNELS.updateCheck, () => lifecycle.check());
  ipcMain.handle(CHANNELS.updateDownload, () => lifecycle.download());
  ipcMain.handle(CHANNELS.updateInstall, () => lifecycle.install());

  return {
    forgetWindow: (label) => flight.forget(label),
    isInstalling: () => lifecycle.isInstalling(),
  };
}
