/**
 * Quit and the busy census — the port of `src-tauri/src/quit_flow.rs` and
 * `src-tauri/src/pane_census.rs`.
 *
 * With peer windows, quit used to be broadcast: every window ran its own guard
 * and every window opened its own dialog. Here exactly one window is asked,
 * behind a global in-flight lock, and the census that dialog shows is computed
 * in the MAIN PROCESS from live PTY state rather than from whichever renderer
 * happens to answer.
 *
 * That last part is the whole point and must not drift back into the renderer:
 * a wedged webview would otherwise make quit unanswerable.
 */
import type { PtyInfo } from "./pty/info";

function isBusy(info: PtyInfo): boolean {
  return info.kind === "agent" || info.kind === "busy";
}

/** True when every pane is explicitly an idle shell — the one case that skips
 * the dialog entirely. Note `unknown` is NOT idle: an unclassified pane must
 * still prompt. */
export function allIdle(infos: readonly PtyInfo[]): boolean {
  return infos.every((info) => info.kind === "idle-shell");
}

export interface BusyCensus {
  readonly requestId: number;
  /** Deduplicated busy process names, in pane order. */
  readonly busyProcesses: string[];
  /** Panes, not names: three panes running `claude` are one name and three
   * panes, and the dialog must say three. */
  readonly busyPanes: number;
  /** False when any pane could not be classified — the dialog then uses the
   * generic "could not verify" copy. */
  readonly fullyNamed: boolean;
  /**
   * Absolute paths of unsaved editor buffers in scope (spec §6).
   *
   * Folded in HERE, beside the pane census, rather than asked of the renderer
   * at prompt time: the census stays answerable from main alone, which is the
   * invariant that put it in main in the first place.
   */
  readonly dirtyFiles: string[];
}

export function censusFor(
  requestId: number,
  infos: readonly PtyInfo[],
  dirtyFiles: readonly string[] = [],
): BusyCensus {
  const busy = infos.filter(isBusy);
  const busyProcesses: string[] = [];
  for (const info of busy) {
    if (info.process !== null && !busyProcesses.includes(info.process)) {
      busyProcesses.push(info.process);
    }
  }
  const fullyNamed = infos.every((info) => {
    if (info.kind === "idle-shell") {
      return true;
    }
    if (info.kind === "unknown") {
      return false;
    }
    return info.process !== null;
  });
  return {
    requestId,
    busyProcesses,
    busyPanes: busy.length,
    fullyNamed,
    dirtyFiles: [...dirtyFiles],
  };
}

interface InFlight {
  readonly requestId: number;
  readonly window: string;
}

/** At most one quit prompt exists at a time, app-wide. */
export class QuitFlight {
  private current: InFlight | null = null;
  private nextId = 0;

  /** Claim the prompt for `window`. Null means another window already has it —
   * a second quit request must not open a second dialog. */
  tryBegin(window: string): number | null {
    if (this.current !== null) {
      return null;
    }
    this.nextId += 1;
    this.current = { requestId: this.nextId, window };
    return this.nextId;
  }

  /** Release the prompt. False for a stale or unknown id, so a late reply from
   * a previous quit cannot cancel the current one. */
  finish(requestId: number): boolean {
    if (this.current?.requestId !== requestId) {
      return false;
    }
    this.current = null;
    return true;
  }

  holder(): string | null {
    return this.current?.window ?? null;
  }

  /** Release the prompt if `label` was holding it. With peers the window
   * showing the dialog can die first; without this, quit stays locked for the
   * rest of the process. */
  forgetWindow(label: string): boolean {
    if (this.current?.window !== label) {
      return false;
    }
    this.current = null;
    return true;
  }
}

/**
 * One outstanding close prompt PER WINDOW — the port of `CloseFlight` in
 * `src-tauri/src/window_close.rs`.
 *
 * Per window, not global: closing two windows at once is ordinary, and each
 * guards only its own panes. Sharing the global `QuitFlight` here was a real
 * bug — the second window's close was prevented with no dialog and no message,
 * because `tryBegin` failed for a reason that meant something else entirely.
 */
export class CloseFlight {
  private readonly pending = new Map<string, number>();
  private nextId = 0;

  /** Claim the prompt for `label`. Null means this window already has one. */
  tryBegin(label: string): number | null {
    if (this.pending.has(label)) {
      return null;
    }
    this.nextId += 1;
    this.pending.set(label, this.nextId);
    return this.nextId;
  }

  /**
   * Consume the prompt. False for a stale id OR a mismatched window, so a
   * reply belonging to an earlier close attempt cannot destroy a window the
   * user kept — and a quit reply cannot answer a close prompt.
   */
  take(label: string, requestId: number): boolean {
    if (this.pending.get(label) !== requestId) {
      return false;
    }
    this.pending.delete(label);
    return true;
  }

  forget(label: string): void {
    this.pending.delete(label);
  }
}
