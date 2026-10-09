/**
 * The Changes list's state and lifecycle for one window (plan
 * 2026-10-10-changes-list, C4–C6).
 *
 * It owns three things and nothing else: the last good reply per shown root,
 * the scheduler that decides when git runs, and the host watch that is held only
 * while the list is shown and the window is visible. The Explorer view reads
 * `state` and calls `setShown`; the window installs the focus, visibility and
 * turn-end triggers once (`installChangesTriggers`).
 */
import { signal, type ReadonlySignal } from "@preact/signals";
import * as hostFacade from "../../host/git-changes-host";
import type { ChangesFailure, ChangesReply, ChangesSnapshot } from "../../host/git-changes-host";
import { createChangesScheduler, type SchedulerClock, type TriggerKind } from "./changes-scheduler";
import { installTurnEndWatch } from "./turn-end";

export interface ChangesHostPort {
  readChanges(root: string): Promise<ChangesReply>;
  watchChanges(root: string | null): Promise<void>;
  listenChanged(handler: (root: string) => void): Promise<() => void>;
}

export interface ChangesState {
  /** The root this state belongs to; null when the list is not shown. */
  readonly root: string | null;
  /** The last good reply. Kept across transient failures, cleared when the
   * folder stops being a repository. */
  readonly snapshot: ChangesSnapshot | null;
  /** The newest failure, or null after a successful read. */
  readonly failure: ChangesFailure | null;
  /** True until the first reply for this root arrives. */
  readonly reading: boolean;
}

const EMPTY: ChangesState = { root: null, snapshot: null, failure: null, reading: false };

export interface ChangesController {
  readonly state: ReadonlySignal<ChangesState>;
  /** The root whose list is on screen, or null. */
  setShown(root: string | null): void;
  setWindowVisible(visible: boolean): void;
  trigger(kind: TriggerKind): void;
  /** A pane of `workspacePath` stopped working. */
  turnEnded(workspacePath: string): void;
  dispose(): void;
}

export interface ChangesControllerDeps {
  readonly host: ChangesHostPort;
  readonly clock?: SchedulerClock;
}

function sameSnapshot(a: ChangesSnapshot | null, b: ChangesSnapshot | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

function sameFailure(a: ChangesFailure | null, b: ChangesFailure | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.message === b.message);
}

export function createChangesController(deps: ChangesControllerDeps): ChangesController {
  const { host } = deps;
  const state = signal<ChangesState>(EMPTY);
  let root: string | null = null;
  let windowVisible = true;
  let watchedRoot: string | null = null;
  let disposed = false;
  let unlisten: (() => void) | null = null;

  const publish = (next: ChangesState): void => {
    const current = state.peek();
    if (
      current.root === next.root &&
      current.reading === next.reading &&
      sameSnapshot(current.snapshot, next.snapshot) &&
      sameFailure(current.failure, next.failure)
    ) {
      // An unchanged reply is not a re-render.
      return;
    }
    state.value = next;
  };

  async function read(): Promise<void> {
    const target = root;
    if (target === null) {
      return;
    }
    let reply: ChangesReply;
    try {
      reply = await host.readChanges(target);
    } catch (error) {
      reply = {
        kind: "failed",
        message: error instanceof Error ? error.message : "Could not read the changes",
      };
    }
    if (disposed || root !== target) {
      // The list moved to another root while git ran.
      return;
    }
    const current = state.peek();
    if (reply.kind === "changes") {
      publish({ root: target, snapshot: reply, failure: null, reading: false });
    } else {
      // A transient failure keeps the last list; a folder that is no longer a
      // repository has nothing true left to show.
      publish({
        root: target,
        snapshot: reply.kind === "not-repository" ? null : current.snapshot,
        failure: reply,
        reading: false,
      });
    }
  }

  const scheduler = createChangesScheduler({ read, clock: deps.clock });

  const applyActivity = (): void => {
    const active = root !== null && windowVisible;
    const desired = active ? root : null;
    if (desired !== watchedRoot) {
      watchedRoot = desired;
      // A watch that cannot open degrades to focus, turn end and Refresh.
      void host.watchChanges(desired).catch(() => {});
    }
    scheduler.setActive(active);
  };

  void host
    .listenChanged((changedRoot) => {
      if (changedRoot === root) {
        scheduler.trigger("watch");
      }
    })
    .then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    })
    .catch(() => {});

  return {
    state,
    setShown(next) {
      if (next === root) {
        return;
      }
      const wasActive = root !== null && windowVisible;
      root = next;
      publish(next === null ? EMPTY : { root: next, snapshot: null, failure: null, reading: true });
      applyActivity();
      if (wasActive && next !== null) {
        // The scheduler stayed active across the move; ask for the new root.
        scheduler.trigger("shown");
      }
    },
    setWindowVisible(visible) {
      if (visible === windowVisible) {
        return;
      }
      windowVisible = visible;
      applyActivity();
    },
    trigger: (kind) => scheduler.trigger(kind),
    turnEnded(workspacePath) {
      if (root !== null && workspacePath === root) {
        scheduler.trigger("turn-end");
      }
    },
    dispose() {
      disposed = true;
      scheduler.dispose();
      unlisten?.();
      unlisten = null;
      if (watchedRoot !== null) {
        watchedRoot = null;
        void host.watchChanges(null).catch(() => {});
      }
    },
  };
}

let shared: ChangesController | null = null;

/** The window's one controller, over the real host. Window-scoped (R5). */
export function changesController(): ChangesController {
  shared ??= createChangesController({ host: hostFacade });
  return shared;
}

/**
 * The window-level triggers: visibility gates everything, focus reads once, a
 * pane leaving `working` reads the checkout it belongs to. Install once.
 */
export function installChangesTriggers(
  controller: ChangesController = changesController(),
): () => void {
  const onVisibility = (): void => {
    controller.setWindowVisible(document.visibilityState === "visible");
  };
  const onFocus = (): void => controller.trigger("focus");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  onVisibility();
  const stopTurnEnds = installTurnEndWatch((workspacePath) => controller.turnEnded(workspacePath));
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    stopTurnEnds();
  };
}
