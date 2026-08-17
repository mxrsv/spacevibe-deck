/**
 * The Electron host's update lifecycle: check → download → install.
 *
 * The renderer half already exists and is host-agnostic
 * (`src/updater/update-controller.ts`); this is the half that talks to
 * `electron-updater`. Nothing here imports `electron-updater` or `electron`:
 * the updater arrives as an injected, lazily loaded dependency so the state
 * machine is unit-testable with the network layer faked, and so a dev run that
 * can never update (`app.isPackaged === false`) never constructs it at all.
 *
 * Three decisions this module encodes, each of which is a correctness rule
 * rather than a preference:
 *
 *  - **`autoInstallOnAppQuit` is off.** It defaults ON, which would install a
 *    downloaded-but-unconfirmed update on any ordinary quit — behind the
 *    renderer's busy-pane confirmation AND behind `recordAttempt`, whose whole
 *    contract is that the record is written before control leaves the app.
 *  - **`install()` never resolves on success.** `quitAndInstall` hands the app
 *    to Squirrel (macOS) or the NSIS installer (Windows), both of which
 *    relaunch Deck themselves. Resolving would let the controller run its
 *    `relaunch()` step next — `app.relaunch(); app.exit(0)` — racing a second
 *    launch against a bundle that is being replaced. It still REJECTS, so the
 *    controller's `install-failed` state stays reachable.
 *  - **`isInstalling()` is read by main's quit and close census.**
 *    `quitAndInstall` closes every window and only then emits `before-quit`,
 *    so without that flag the install deadlocks behind a second prompt the
 *    renderer already answered through `confirmInstall`.
 */

/** The `electron-updater` surface this module uses, and nothing wider. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<UpdateCheckLike | null>;
  downloadUpdate(): Promise<readonly string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(
    event: "update-downloaded" | "error",
    handler: (payload: never) => void,
  ): unknown;
}

/** `electron-updater`'s `UpdateCheckResult`, narrowed to what is read here. */
export interface UpdateCheckLike {
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: {
    readonly version: string;
    readonly releaseNotes?: string | unknown | null;
  };
}

/**
 * The reply to `update_check`, flat by contract (R6).
 *
 * `unsupported` is a first-class answer, not an error: an unpackaged dev run
 * and a build with no feed genuinely cannot update, and the renderer must be
 * able to say so instead of reporting "SpaceVibe Deck is up to date".
 */
export type UpdateCheckReply =
  | { readonly status: "unsupported" }
  | { readonly status: "current"; readonly currentVersion: string }
  | {
      readonly status: "available";
      readonly currentVersion: string;
      readonly version: string;
      readonly notes: string | null;
    };

export interface UpdateLifecycleDependencies {
  /**
   * Load and configure the real updater. Called at most once, and only when
   * `supported` is true, so `electron-updater` is never constructed in a run
   * that cannot use it.
   */
  loadUpdater(): AutoUpdaterLike;
  /** `app.isPackaged` in the host — false means there is nothing to update. */
  readonly supported: boolean;
  readonly currentVersion: string;
  /**
   * Everything that must happen before control leaves the app: kill the PTYs
   * and flush the stores, the same order `confirm_quit` uses. The install exit
   * bypasses main's quit census by design, so this is the only place that work
   * can happen on this path.
   */
  prepareForInstall(): Promise<void>;
  report(message: string, error: unknown): void;
}

export interface UpdateLifecycle {
  check(): Promise<UpdateCheckReply>;
  download(): Promise<void>;
  install(): Promise<void>;
  /** True from the moment the install begins until it fails. */
  isInstalling(): boolean;
}

interface Settle {
  resolve(): void;
  reject(error: Error): void;
}

function releaseNotesText(notes: unknown): string | null {
  // GitHub releases give a string; other providers give an array of
  // `{ version, note }`. Anything else is dropped rather than stringified into
  // "[object Object]" and shown to the user.
  if (typeof notes === "string") {
    return notes;
  }
  if (Array.isArray(notes)) {
    const joined = notes
      .map((entry) =>
        typeof entry === "object" && entry !== null && "note" in entry
          ? String((entry as { note: unknown }).note ?? "")
          : "",
      )
      .filter((note) => note.length > 0)
      .join("\n");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createUpdateLifecycle(
  deps: UpdateLifecycleDependencies,
): UpdateLifecycle {
  let updater: AutoUpdaterLike | null = null;
  let availableVersion: string | null = null;
  let downloadedVersion: string | null = null;
  let downloadInFlight: Promise<void> | null = null;
  let downloadSettle: Settle | null = null;
  /** The version the in-flight download is actually fetching. */
  let downloadTarget: string | null = null;
  let installInFlight: Promise<void> | null = null;
  let installSettle: Settle | null = null;
  /** Set once the installer has accepted the handover; never cleared. */
  let handedOver = false;
  let errorSink: ((error: Error) => void) | null = null;

  const settleDownload = (): void => {
    if (downloadTarget === null) {
      return;
    }
    // The version this download FETCHED, never whatever the newest check
    // happens to have found since. Reading `availableVersion` here meant a
    // check in another window landing mid-download relabelled the finished
    // file: that window was told the newer version was ready, and installing
    // it would have installed the older one.
    downloadedVersion = downloadTarget;
    downloadSettle?.resolve();
  };

  const load = (): AutoUpdaterLike => {
    if (updater !== null) {
      return updater;
    }
    const loaded = deps.loadUpdater();
    // Both flags are load-bearing; see the docblock.
    loaded.autoDownload = false;
    loaded.autoInstallOnAppQuit = false;
    loaded.on("update-downloaded", () => settleDownload());
    loaded.on("error", (error) => {
      // `electron-updater` has ONE error channel for every operation, so an
      // error here may belong to a check another window started. Blaming it on
      // whatever is outstanding was worse than useless: a failed check during
      // an install reported `install-failed`, dropped `isInstalling()` while
      // the installer was still staging, and left the quit census back in
      // force to deadlock the handover it had just stood aside for. The sink
      // is armed only where an error can be attributed with certainty.
      const sink = errorSink;
      if (sink !== null) {
        sink(asError(error));
        return;
      }
      deps.report("Updater reported an error", error);
    });
    updater = loaded;
    return loaded;
  };

  const check = async (): Promise<UpdateCheckReply> => {
    if (!deps.supported) {
      return { status: "unsupported" };
    }
    const result = await load().checkForUpdates();
    if (result === null) {
      // `electron-updater` answers null when it refuses to run at all — an
      // unpackaged app, or no update configuration. Honest "unsupported", not
      // "up to date".
      return { status: "unsupported" };
    }
    if (!result.isUpdateAvailable) {
      return { status: "current", currentVersion: deps.currentVersion };
    }
    const version = result.updateInfo.version;
    if (version !== availableVersion) {
      // A different update than the one already fetched: the downloaded file
      // on disk is no longer the one this reply describes.
      downloadedVersion = null;
    }
    availableVersion = version;
    return {
      status: "available",
      currentVersion: deps.currentVersion,
      version,
      notes: releaseNotesText(result.updateInfo.releaseNotes),
    };
  };

  const download = (): Promise<void> => {
    const target = availableVersion;
    if (target === null) {
      return Promise.reject(new Error("No update has been found to download."));
    }
    if (downloadedVersion === target) {
      return Promise.resolve();
    }
    if (downloadInFlight !== null) {
      // Two windows can both press Update. The startup single-flight in
      // `register-updater.ts` only covers the automatic check, so the download
      // is deduplicated here — but only for the SAME version. Handing back a
      // promise that will finish a different file is how a window ends up
      // believing it has what it asked for.
      return downloadTarget === target
        ? downloadInFlight
        : Promise.reject(
            new Error(
              `Deck is already downloading ${downloadTarget ?? "another update"}.`,
            ),
          );
    }
    downloadTarget = target;
    downloadInFlight = new Promise<void>((resolve, reject) => {
      downloadSettle = { resolve, reject };
    }).finally(() => {
      downloadInFlight = null;
      downloadSettle = null;
      downloadTarget = null;
    });
    // Resolved by whichever finishes first: `update-downloaded` fires before
    // `downloadUpdate` resolves on both MacUpdater and NsisUpdater, but the
    // pair costs nothing and neither one alone is guaranteed by contract.
    // Failures come from the promise ONLY — `downloadUpdate` rejects with the
    // same error it reports on the event channel, and the event channel cannot
    // tell this download's failure from another window's failed check.
    load()
      .downloadUpdate()
      .then(() => settleDownload())
      .catch((error: unknown) => downloadSettle?.reject(asError(error)));
    return downloadInFlight;
  };

  const install = (): Promise<void> => {
    if (handedOver) {
      // A second handover is never safe. `BaseUpdater.install` refuses one
      // silently when `quitAndInstallCalled` is already set — it logs and
      // returns false without dispatching an error, so this promise would wait
      // forever — and `MacUpdater.quitAndInstall` adds another
      // `update-downloaded` listener each time, so a later success would run
      // the handover once per attempt.
      return Promise.reject(
        new Error("Deck has already handed this update to the installer."),
      );
    }
    if (availableVersion === null || downloadedVersion !== availableVersion) {
      // Also the guard for "another window downloaded a different version":
      // refusing is the honest answer, because the file on disk is not the one
      // this window is showing.
      return Promise.reject(
        new Error("The update has not finished downloading yet."),
      );
    }
    if (installInFlight !== null) {
      return installInFlight;
    }
    installInFlight = new Promise<void>((_resolve, reject) => {
      // No `resolve` is captured on purpose: success ends this process. See
      // the docblock.
      installSettle = {
        resolve: () => {},
        reject: (error) => {
          installInFlight = null;
          installSettle = null;
          reject(error);
        },
      };
    });
    void (async () => {
      try {
        await deps.prepareForInstall();
      } catch (error: unknown) {
        installSettle?.reject(asError(error));
        return;
      }
      // `quitAndInstall` reports a refused handover through the error channel
      // rather than by throwing, and it does so SYNCHRONOUSLY (BaseUpdater
      // dispatches before returning false, and resets its own flag so a retry
      // is safe). That window is the only place an error on the shared channel
      // is certainly this install's, so it is the only place the sink is armed.
      let handoverError: Error | null = null;
      errorSink = (error) => {
        handoverError = error;
      };
      try {
        load().quitAndInstall(false, true);
      } catch (error: unknown) {
        handoverError = asError(error);
      } finally {
        errorSink = null;
      }
      if (handoverError !== null) {
        installSettle?.reject(handoverError);
        return;
      }
      handedOver = true;
    })();
    return installInFlight;
  };

  return Object.freeze({
    check,
    download,
    install,
    isInstalling: () => installInFlight !== null,
  });
}
