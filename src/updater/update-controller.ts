import { signal, type ReadonlySignal } from "@preact/signals";
import type { DesktopPlatform } from "../lib/platform";

const MAX_RELEASE_NOTES_LENGTH = 400;

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

export interface UpdateControllerDependencies {
  readonly platform: DesktopPlatform;
  check(): Promise<PendingUpdate | null>;
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
  | "available"
  | "current"
  | "unsupported"
  | "failed";

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
        update = await deps.check();
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

  const start = async (): Promise<void> => {
    if (started) {
      return;
    }
    started = true;
    await checkForAvailableUpdate();
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
        await deps.recordAttempt(update.version);
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
