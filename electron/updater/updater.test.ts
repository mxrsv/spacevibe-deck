/**
 * The update state machine with the network layer faked.
 *
 * Gate A cannot be replaced by a unit test — discover → download → install →
 * relaunch on a signed build is a manual proof by design (migration design
 * §11). What IS provable here is everything that has bitten this repo before:
 * the two `electron-updater` flags that default to the wrong thing, the
 * ordering that keeps `recordAttempt` meaningful, and the install exit that
 * has to be visible to main's quit census.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createUpdateLifecycle,
  type AutoUpdaterLike,
  type UpdateCheckLike,
  type UpdateLifecycleDependencies,
} from "./updater";

type Handler = (payload: never) => void;

class FakeUpdater implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  checkResult: UpdateCheckLike | null = null;
  checkError: Error | null = null;
  downloadCalls = 0;
  quitAndInstallCalls: Array<readonly [boolean | undefined, boolean | undefined]> = [];
  readonly order: string[] = [];
  private readonly handlers = new Map<string, Handler[]>();
  private downloadSettle: {
    resolve: (paths: readonly string[]) => void;
    reject: (error: Error) => void;
  } | null = null;

  checkForUpdates(): Promise<UpdateCheckLike | null> {
    return this.checkError === null
      ? Promise.resolve(this.checkResult)
      : Promise.reject(this.checkError);
  }

  downloadUpdate(): Promise<readonly string[]> {
    this.downloadCalls += 1;
    return new Promise((resolve, reject) => {
      this.downloadSettle = { resolve, reject };
    });
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.order.push("quitAndInstall");
    this.quitAndInstallCalls.push([isSilent, isForceRunAfter]);
  }

  on(event: "update-downloaded" | "error", handler: Handler): unknown {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...existing, handler]);
    return this;
  }

  emit(event: "update-downloaded" | "error", payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload as never);
    }
  }

  finishDownload(): void {
    this.downloadSettle?.resolve([]);
  }

  failDownload(error: Error): void {
    this.downloadSettle?.reject(error);
  }
}

function setup(overrides: Partial<UpdateLifecycleDependencies> = {}): {
  lifecycle: ReturnType<typeof createUpdateLifecycle>;
  updater: FakeUpdater;
  prepareForInstall: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
} {
  const updater = new FakeUpdater();
  const prepareForInstall = vi.fn(() => {
    updater.order.push("prepareForInstall");
    return Promise.resolve();
  });
  const report = vi.fn();
  const lifecycle = createUpdateLifecycle({
    loadUpdater: () => updater,
    supported: true,
    currentVersion: "0.12.3",
    prepareForInstall,
    report,
    ...overrides,
  });
  return { lifecycle, updater, prepareForInstall, report };
}

const AVAILABLE: UpdateCheckLike = {
  isUpdateAvailable: true,
  updateInfo: { version: "0.13.0", releaseNotes: "Fixes the thing." },
};

describe("check", () => {
  it("answers unsupported without ever constructing the updater", async () => {
    const loadUpdater = vi.fn(() => new FakeUpdater());
    const { lifecycle } = setup({ supported: false, loadUpdater });

    // The whole reason `loadUpdater` is a function: a dev run must not build
    // `electron-updater` at all, and the answer must be "unsupported" rather
    // than the "up to date" this host used to report.
    await expect(lifecycle.check()).resolves.toEqual({ status: "unsupported" });
    expect(loadUpdater).not.toHaveBeenCalled();
  });

  it("answers unsupported when electron-updater refuses to run", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = null;

    await expect(lifecycle.check()).resolves.toEqual({ status: "unsupported" });
  });

  it("turns both auto flags off the first time it loads the updater", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = {
      isUpdateAvailable: false,
      updateInfo: { version: "0.12.3" },
    };

    await lifecycle.check();

    // `autoInstallOnAppQuit` defaults ON: a downloaded update would install on
    // the next ordinary quit, behind the renderer's busy-pane confirmation and
    // behind `recordAttempt`.
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("allows pre-releases, because the channel lives in the version", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = {
      isUpdateAvailable: false,
      updateInfo: { version: "0.12.3" },
    };

    await lifecycle.check();

    // The Electron releases are published as pre-releases on `X.Y.Z-electron.N`
    // so that they cannot be confused with the Tauri releases in the same
    // repository. `allowPrerelease` defaults OFF, and with it off
    // `GitHubProvider` resolves `releases/latest` — a Tauri release, which
    // carries no `electron-mac.yml` — instead of walking the feed for the
    // channel this build's own version names. The whole pipeline would build,
    // publish and verify clean, and every check would answer "up to date".
    expect(updater.allowPrerelease).toBe(true);
  });

  it("reports current with the host's version", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = {
      isUpdateAvailable: false,
      updateInfo: { version: "0.12.3" },
    };

    await expect(lifecycle.check()).resolves.toEqual({
      status: "current",
      currentVersion: "0.12.3",
    });
  });

  it("reports an available update with flattened release notes", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = {
      isUpdateAvailable: true,
      updateInfo: {
        version: "0.13.0",
        releaseNotes: [{ note: "One." }, { note: "Two." }],
      },
    };

    await expect(lifecycle.check()).resolves.toEqual({
      status: "available",
      currentVersion: "0.12.3",
      version: "0.13.0",
      notes: "One.\nTwo.",
    });
  });

  it("drops release notes it cannot read rather than stringifying them", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.13.0", releaseNotes: { body: "nope" } },
    };

    await expect(lifecycle.check()).resolves.toMatchObject({ notes: null });
  });

  it("propagates a failed check so the renderer can say so", async () => {
    const { lifecycle, updater } = setup();
    updater.checkError = new Error("offline");

    await expect(lifecycle.check()).rejects.toThrow("offline");
  });
});

describe("download", () => {
  it("refuses to download before a check found something", async () => {
    const { lifecycle } = setup();

    await expect(lifecycle.download()).rejects.toThrow("No update has been found");
  });

  it("resolves when update-downloaded arrives", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    const downloading = lifecycle.download();
    updater.emit("update-downloaded");

    await expect(downloading).resolves.toBeUndefined();
  });

  it("resolves when downloadUpdate resolves without the event", async () => {
    // Providers differ on which of the two comes first; waiting for only one
    // hangs on the other.
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    const downloading = lifecycle.download();
    updater.finishDownload();

    await expect(downloading).resolves.toBeUndefined();
  });

  it("deduplicates concurrent downloads from two windows", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    const first = lifecycle.download();
    const second = lifecycle.download();
    updater.emit("update-downloaded");
    await Promise.all([first, second]);

    expect(updater.downloadCalls).toBe(1);
  });

  it("ignores an error event that may belong to another window's check", async () => {
    // `electron-updater` reports every failure on one channel. A check failing
    // in a peer window must not cancel this download — and a real download
    // failure rejects the promise anyway, which the next case covers.
    const { lifecycle, updater, report } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    const downloading = lifecycle.download();
    const settled = vi.fn();
    void downloading.then(settled, settled);
    updater.emit("error", new Error("feed unreachable"));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("Updater reported an error", expect.any(Error));
    updater.emit("update-downloaded");
    await expect(downloading).resolves.toBeUndefined();
  });

  it("refuses a concurrent download of a different version", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();
    const first = lifecycle.download();

    updater.checkResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.14.0" },
    };
    await lifecycle.check();

    await expect(lifecycle.download()).rejects.toThrow("already downloading 0.13.0");
    updater.emit("update-downloaded");
    await first;
  });

  it("credits a finished download to the version it fetched", async () => {
    // A check landing mid-download used to relabel the finished file: the
    // second window was told 0.14.0 was ready while 0.13.0 sat on disk, and
    // installing would have installed 0.13.0 behind 0.14.0's name.
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();
    const downloading = lifecycle.download();

    updater.checkResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.14.0" },
    };
    await lifecycle.check();
    updater.emit("update-downloaded");
    await downloading;

    await expect(lifecycle.install()).rejects.toThrow("has not finished downloading");
    expect(updater.quitAndInstallCalls).toEqual([]);
  });

  it("rejects when downloadUpdate itself fails, and allows a retry", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    const failing = lifecycle.download();
    updater.failDownload(new Error("disk full"));
    await expect(failing).rejects.toThrow("disk full");

    const retry = lifecycle.download();
    updater.emit("update-downloaded");
    await expect(retry).resolves.toBeUndefined();
    expect(updater.downloadCalls).toBe(2);
  });

  it("re-downloads when a later check names a different version", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();
    const first = lifecycle.download();
    updater.emit("update-downloaded");
    await first;

    updater.checkResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.14.0" },
    };
    await lifecycle.check();
    const second = lifecycle.download();
    updater.emit("update-downloaded");
    await second;

    expect(updater.downloadCalls).toBe(2);
  });
});

describe("install", () => {
  async function downloaded() {
    const harness = setup();
    harness.updater.checkResult = AVAILABLE;
    await harness.lifecycle.check();
    const downloading = harness.lifecycle.download();
    harness.updater.emit("update-downloaded");
    await downloading;
    return harness;
  }

  it("refuses to install an update that is not downloaded", async () => {
    const { lifecycle, updater } = setup();
    updater.checkResult = AVAILABLE;
    await lifecycle.check();

    await expect(lifecycle.install()).rejects.toThrow("has not finished downloading");
    expect(updater.quitAndInstallCalls).toEqual([]);
  });

  it("kills the panes and flushes the stores before handing over", async () => {
    const { lifecycle, updater } = await downloaded();

    void lifecycle.install();
    await vi.waitFor(() => expect(updater.quitAndInstallCalls.length).toBe(1));

    // Ordering, not just presence: the install exit bypasses main's quit
    // census, so this is the only chance to end the PTYs and write the stores.
    expect(updater.order).toEqual(["prepareForInstall", "quitAndInstall"]);
    expect(updater.quitAndInstallCalls[0]).toEqual([false, true]);
  });

  it("marks itself installing before quitAndInstall closes the windows", async () => {
    const { lifecycle, updater } = await downloaded();

    void lifecycle.install();

    // Synchronously true: `quitAndInstall` closes every window and only then
    // emits `before-quit`, and main's census reads this flag to stand aside.
    expect(lifecycle.isInstalling()).toBe(true);
    await vi.waitFor(() => expect(updater.quitAndInstallCalls.length).toBe(1));
  });

  it("never resolves once the installer has taken over", async () => {
    const { lifecycle, updater } = await downloaded();

    const settled = vi.fn();
    void lifecycle.install().then(settled, settled);
    await vi.waitFor(() => expect(updater.quitAndInstallCalls.length).toBe(1));
    await Promise.resolve();

    // Resolving would let the controller run its own relaunch step, racing a
    // second launch against a bundle Squirrel/NSIS is replacing.
    expect(settled).not.toHaveBeenCalled();
  });

  it("rejects and clears the flag when the handover fails", async () => {
    const { lifecycle, updater } = await downloaded();
    updater.quitAndInstall = () => {
      throw new Error("ShipIt is missing");
    };

    await expect(lifecycle.install()).rejects.toThrow("ShipIt is missing");
    expect(lifecycle.isInstalling()).toBe(false);
  });

  it("rejects when the teardown fails, without handing over", async () => {
    const harness = setup({
      prepareForInstall: () => Promise.reject(new Error("could not save")),
    });
    harness.updater.checkResult = AVAILABLE;
    await harness.lifecycle.check();
    const downloading = harness.lifecycle.download();
    harness.updater.emit("update-downloaded");
    await downloading;

    await expect(harness.lifecycle.install()).rejects.toThrow("could not save");
    expect(harness.updater.quitAndInstallCalls).toEqual([]);
    expect(harness.lifecycle.isInstalling()).toBe(false);
  });

  it("keeps standing aside when a late error lands on the shared channel", async () => {
    // The deadlock this guards: a peer window's failed check reported the
    // install as failed, `isInstalling()` went false while the installer was
    // still staging, and the census that had stood aside came back in force —
    // so the windows the installer then closed each raised a prompt.
    const { lifecycle, updater, report } = await downloaded();

    const installing = lifecycle.install();
    const settled = vi.fn();
    void installing.then(settled, settled);
    await vi.waitFor(() => expect(updater.quitAndInstallCalls.length).toBe(1));
    updater.emit("error", new Error("feed unreachable"));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(lifecycle.isInstalling()).toBe(true);
    expect(report).toHaveBeenCalledWith("Updater reported an error", expect.any(Error));
  });

  it("rejects when the handover is refused on the error channel, and stays retryable", async () => {
    // `BaseUpdater.install` reports a refused handover by dispatching an error
    // and returning false, synchronously — it never throws.
    const { lifecycle, updater } = await downloaded();
    updater.quitAndInstall = () => {
      updater.emit("error", new Error("No update filepath provided"));
    };

    await expect(lifecycle.install()).rejects.toThrow("No update filepath provided");
    expect(lifecycle.isInstalling()).toBe(false);
  });

  it("refuses a second handover once the installer has taken the update", async () => {
    // A retry past this point hits `quitAndInstallCalled` on NSIS — refused
    // silently, with no error — and stacks another `update-downloaded`
    // listener on macOS.
    const { lifecycle, updater } = await downloaded();

    void lifecycle.install();
    await vi.waitFor(() => expect(updater.quitAndInstallCalls.length).toBe(1));

    await expect(lifecycle.install()).rejects.toThrow(
      "already handed this update to the installer",
    );
    expect(updater.quitAndInstallCalls.length).toBe(1);
  });
});

describe("idle errors", () => {
  it("are reported rather than dropped", async () => {
    const { lifecycle, updater, report } = setup();
    updater.checkResult = {
      isUpdateAvailable: false,
      updateInfo: { version: "0.12.3" },
    };
    await lifecycle.check();

    updater.emit("error", new Error("feed unreachable"));

    expect(report).toHaveBeenCalledWith("Updater reported an error", expect.any(Error));
  });
});
