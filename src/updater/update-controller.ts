import { signal, type ReadonlySignal } from "@preact/signals";
import { invoke } from "../host/bridge";
import type { DesktopPlatform } from "../lib/platform";

const MAX_RELEASE_NOTES_LENGTH = 400;

/**
 * How often a window that found nothing at launch looks again.
 *
 * Six hours: long enough that a day of work sees at most a few checks, short
 * enough that a Deck left open across a working day still finds the build that
 * shipped that morning. There is no exponential backoff and no jitter — one
 * conditional request to GitHub per window per six hours is not a load worth
 * engineering around.
 */
export const BACKGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase =
  | "hidden"
  | "available"
  | "downloading"
  | "downloaded"
  | "download-failed"
  | "installing"
  | "install-failed"
  | "relaunch-failed";

export interface UpdateView {
  readonly phase: UpdatePhase;
  readonly currentVersion: string;
  readonly availableVersion: string;
  readonly notes: string;
}

export interface PendingUpdate {
  readonly currentVersion: string;
  readonly version: string;
  readonly notes: string | null;
  download(): Promise<void>;
  install(): Promise<void>;
}

/**
 * "This build cannot update itself", as distinct from "nothing new".
 *
 * `check()` returning `null` used to carry both meanings, and the Electron
 * host — which had no updater at all — therefore answered "SpaceVibe Deck is
 * up to date" to every check. That is a false statement, not a missing
 * feature. `deps.platform === "unsupported"` cannot cover it: Electron reports
 * a real platform and still has no updater until a build is packaged and
 * signed, so the ADAPTER is the only layer that knows.
 */
export const UPDATE_UNSUPPORTED = "update-unsupported";
export type UpdateUnsupported = typeof UPDATE_UNSUPPORTED;

export interface UpdateControllerDependencies {
  readonly platform: DesktopPlatform;
  check(): Promise<PendingUpdate | UpdateUnsupported | null>;
  confirmInstall(): Promise<boolean>;
  flush(): Promise<void>;
  relaunch(): Promise<void>;
  report(message: string, error: unknown): void;
  /**
   * Write down what is being installed, before control leaves the app. The
   * installer runs outside Deck and on Windows exits this process outright, so
   * this record is the only way the next launch can tell a finished install
   * from one that never happened.
   */
  recordAttempt(targetVersion: string): Promise<void>;
  /**
   * Claim the right to run the automatic startup check. Rust holds a
   * process-wide single-flight (spec §9.5) so peer windows do not each
   * download the same update — "the first window is primary" fails when the
   * first window dies first. Defaults to the real command.
   *
   * Fail-OPEN on error: a broken single-flight must degrade to "every window
   * checks", never to "nobody checks". A duplicated download is an
   * annoyance; a silently disabled updater is a security problem.
   */
  claim?: () => Promise<boolean>;
  /** Release the single-flight claim. Defaults to `end_update_check`. */
  releaseClaim?: () => Promise<void>;
}

export interface UpdateController {
  readonly view: ReadonlySignal<UpdateView>;
  start(): Promise<void>;
  checkNow(): Promise<UpdateCheckResult>;
  download(): Promise<void>;
  installAndRelaunch(): Promise<void>;
  relaunch(): Promise<void>;
}

export type UpdateCheckResult =
  "available" | "current" | "unsupported" | "failed";

const HIDDEN_VIEW = Object.freeze<UpdateView>({
  phase: "hidden",
  currentVersion: "",
  availableVersion: "",
  notes: "",
});

function boundedNotes(notes: string | null): string {
  if (notes === null) {
    return "";
  }
  const normalized = notes.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_RELEASE_NOTES_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_RELEASE_NOTES_LENGTH - 1)}…`;
}

function updateView(update: PendingUpdate, phase: UpdatePhase): UpdateView {
  return Object.freeze({
    phase,
    currentVersion: update.currentVersion,
    availableVersion: update.version,
    notes: boundedNotes(update.notes),
  });
}

export function createUpdateController(
  deps: UpdateControllerDependencies,
): UpdateController {
  const view = signal<UpdateView>(HIDDEN_VIEW);
  let update: PendingUpdate | null = null;
  let started = false;
  let operation: Promise<void> | null = null;
  let checkOperation: Promise<UpdateCheckResult> | null = null;

  const singleFlight = (work: () => Promise<void>): Promise<void> => {
    if (operation !== null) {
      return operation;
    }
    operation = work().finally(() => {
      operation = null;
    });
    return operation;
  };

  const checkForAvailableUpdate = (): Promise<UpdateCheckResult> => {
    if (checkOperation !== null) {
      return checkOperation;
    }
    if (deps.platform === "unsupported") {
      return Promise.resolve("unsupported");
    }

    checkOperation = (async () => {
      try {
        const result = await deps.check();
        if (result === UPDATE_UNSUPPORTED) {
          update = null;
          view.value = HIDDEN_VIEW;
          return "unsupported";
        }
        update = result;
        view.value =
          update === null ? HIDDEN_VIEW : updateView(update, "available");
        return update === null ? "current" : "available";
      } catch (error: unknown) {
        deps.report("Update check failed", error);
        view.value = HIDDEN_VIEW;
        return "failed";
      }
    })().finally(() => {
      checkOperation = null;
    });
    return checkOperation;
  };

  /**
   * Phases the timer may check from.
   *
   * The four it excludes are an update the user is mid-way through — on screen
   * to install, downloading, or installing — where a check could replace the
   * very version being acted on, and discard a file already on disk. The three
   * FAILED phases are included on purpose: nothing in the UI returns the view
   * to `hidden`, so treating them as "busy" would mean one dropped connection
   * during a download silences the recheck for the rest of the session.
   */
  const RECHECKABLE_PHASES: ReadonlySet<UpdatePhase> = new Set([
    "hidden",
    "download-failed",
    "install-failed",
    "relaunch-failed",
  ]);

  let recheckTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Stop the timer once the host has said this build cannot update at all.
   *
   * `deps.platform` cannot answer that question — the doc on
   * `UPDATE_UNSUPPORTED` above says why: Electron reports a real platform and
   * only the ADAPTER knows whether the build is packaged and signed. Without
   * this, an unpackaged Electron run would claim the process-wide single-flight
   * and send an IPC round trip every six hours, forever, for an answer that
   * cannot change.
   */
  const stopIfUnsupported = (result: UpdateCheckResult | null): void => {
    if (result !== "unsupported" || recheckTimer === null) {
      return;
    }
    clearInterval(recheckTimer);
    recheckTimer = null;
  };

  const claim = (): Promise<boolean> =>
    deps.claim ? deps.claim() : invoke<boolean>("begin_update_check");
  const release = (): Promise<void> =>
    deps.releaseClaim ? deps.releaseClaim() : invoke<void>("end_update_check");

  /**
   * One claimed check. Shared by the startup pass and the background timer so
   * neither can leak the process-wide single-flight. Answers `null` when a peer
   * window held the claim and this window therefore checked nothing.
   */
  const claimedCheck = async (): Promise<UpdateCheckResult | null> => {
    let mine = true;
    try {
      mine = await claim();
    } catch (err: unknown) {
      console.warn("begin_update_check failed; checking anyway:", err);
    }
    if (!mine) {
      return null;
    }
    try {
      return await checkForAvailableUpdate();
    } finally {
      // ALWAYS released, including when the check throws. The single-flight is
      // process-wide: a claim leaked by a failed check means no window ever
      // auto-checks again for the life of the process. try/catch rather than
      // `.catch()`: outside Tauri `invoke` throws synchronously, which a
      // promise handler would never see.
      try {
        await release();
      } catch (err: unknown) {
        console.warn("end_update_check failed:", err);
      }
    }
  };

  const start = async (): Promise<void> => {
    if (started) {
      return;
    }
    started = true;
    // Armed BEFORE the claim is resolved, and never released. Deck is a
    // terminal people leave open for days, so a window that only ever checked
    // at launch would report a months-old build as current. Arming it after
    // the claim would leave a window that lost that one race with no timer for
    // the whole session — and the peer holding the claim can close at any
    // moment.
    recheckTimer = setInterval(() => {
      if (!RECHECKABLE_PHASES.has(view.value.phase)) {
        return;
      }
      void claimedCheck().then(stopIfUnsupported);
    }, BACKGROUND_CHECK_INTERVAL_MS);
    // No `deps.platform` guard here on purpose. One was written and then
    // removed: deleting it changed nothing a test could observe, because the
    // first check on such a build answers `unsupported` and stops the timer
    // anyway. Two mechanisms for one rule, and only one of them can see the
    // case that actually matters (a packaged-but-unsigned Electron build,
    // where `platform` is a real one).
    stopIfUnsupported(await claimedCheck());
  };

  const checkNow = (): Promise<UpdateCheckResult> =>
    view.value.phase === "hidden"
      ? checkForAvailableUpdate()
      : Promise.resolve("available");

  const download = (): Promise<void> =>
    singleFlight(async () => {
      if (
        update === null ||
        (view.value.phase !== "available" &&
          view.value.phase !== "download-failed")
      ) {
        return;
      }
      view.value = updateView(update, "downloading");
      try {
        await update.download();
        view.value = updateView(update, "downloaded");
      } catch (error: unknown) {
        deps.report("Update download failed", error);
        view.value = updateView(update, "download-failed");
      }
    });

  const relaunch = (): Promise<void> =>
    singleFlight(async () => {
      if (update === null || view.value.phase !== "relaunch-failed") {
        return;
      }
      view.value = updateView(update, "installing");
      try {
        await deps.relaunch();
      } catch (error: unknown) {
        deps.report("Update relaunch failed", error);
        view.value = updateView(update, "relaunch-failed");
      }
    });

  const installAndRelaunch = (): Promise<void> =>
    singleFlight(async () => {
      if (
        update === null ||
        (view.value.phase !== "downloaded" &&
          view.value.phase !== "install-failed")
      ) {
        return;
      }
      if (!(await deps.confirmInstall())) {
        view.value = updateView(update, "downloaded");
        return;
      }
      view.value = updateView(update, "installing");
      try {
        await deps.flush();
        // Ordered before install on purpose: once install() is called on
        // Windows the process can be gone before the next line runs.
        //
        // A failure here ABORTS the install. Installing without the record
        // means a failed install can never be noticed — the exact silence this
        // mechanism exists to end — so proceeding blind is worse than not
        // installing at all. The user keeps a working app and can retry.
        await deps.recordAttempt(update.version);
      } catch (error: unknown) {
        deps.report("Could not record the update attempt", error);
        view.value = updateView(update, "install-failed");
        return;
      }
      try {
        await update.install();
      } catch (error: unknown) {
        deps.report("Update install failed", error);
        view.value = updateView(update, "install-failed");
        return;
      }
      try {
        await deps.relaunch();
      } catch (error: unknown) {
        deps.report("Update relaunch failed", error);
        view.value = updateView(update, "relaunch-failed");
      }
    });

  return Object.freeze({
    view,
    start,
    checkNow,
    download,
    installAndRelaunch,
    relaunch,
  });
}
