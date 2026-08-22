import { ask } from "../host/dialog-host";
import { baseName } from "../lib/path-name";
import type { PaneProcessInfo } from "../lib/process-info";
import { freshPaneInfo } from "./pane-info";
import { defaultPtyClient, type PtyClient } from "./pty-client";

/** Named busy state comes from the explicit process classification. */
export function isBusy(info: PaneProcessInfo): boolean {
  return info.kind === "agent" || info.kind === "busy";
}

/** Busy process names, deduplicated, in pane order. */
export function busyProcesses(infos: readonly PaneProcessInfo[]): string[] {
  const names: string[] = [];
  for (const info of infos) {
    if (isBusy(info) && info.process !== null && !names.includes(info.process)) {
      names.push(info.process);
    }
  }
  return names;
}

/** Dialog copy for the two busy-guard surfaces: close paths and quit. */
export interface ConfirmCopy {
  readonly title: string;
  readonly okLabel: string;
  /** Verb in the question — "Close anyway?" / "Quit anyway?". */
  readonly action: string;
  /**
   * Consequences the verb does not convey, appended as its own paragraph.
   * Closing a tab is reversible enough to need none; replacing the running
   * application is not.
   */
  readonly detail?: string;
}

const CLOSE_COPY: ConfirmCopy = {
  title: "Close Terminal",
  okLabel: "Close",
  action: "Close",
};

/** Closing a file tab with unsaved edits — the third of spec §6's three exits. */
export const FILE_CLOSE_COPY: ConfirmCopy = {
  title: "Close File",
  okLabel: "Discard Changes",
  action: "Close",
};

export const QUIT_COPY: ConfirmCopy = {
  title: "Quit Deck",
  okLabel: "Quit",
  action: "Quit",
};

export const WINDOW_CLOSE_COPY: ConfirmCopy = {
  title: "Close Window",
  okLabel: "Close Window",
  // Not "Quit": with peer windows this kills only THIS window's panes, and
  // the app keeps running unless it was the last one.
  action: "Close this window",
};

export const UPDATE_COPY: ConfirmCopy = {
  title: "Install Deck Update",
  okLabel: "Install & Restart",
  action: "Install update and restart",
  // The installer runs outside Deck and Deck cannot watch it finish: on
  // Windows the updater exits the process the moment it hands over, and on
  // macOS a failure late in the swap can leave neither version in place. So
  // the dialog has to say plainly that this is not a normal restart.
  detail:
    "Deck will quit while it installs. Running processes are terminated and terminal sessions are not restored. If the install fails, Deck may need to be downloaded again.",
};

/** How many unsaved file names are spelled out before the message summarizes. */
const MAX_NAMED_FILES = 3;

/**
 * The unsaved-files half of a confirmation, or null when nothing is unsaved.
 *
 * Basenames, not absolute paths: a dialog listing three 80-character paths is
 * unreadable, and the user is being asked about files they have open, which
 * they recognise by name.
 */
export function dirtyFilesPhrase(paths: readonly string[]): string | null {
  if (paths.length === 0) {
    return null;
  }
  const names = paths.map(baseName);
  if (names.length === 1) {
    return `${names[0]} has unsaved changes`;
  }
  const shown = names.slice(0, MAX_NAMED_FILES).join(", ");
  const rest = names.length - MAX_NAMED_FILES;
  const list = rest > 0 ? `${shown} and ${rest} more` : shown;
  return `${names.length} files have unsaved changes (${list})`;
}

/**
 * `busyPanes` is the count of panes, not of names: three panes all running
 * `claude` deduplicate to one name, and "claude is still running" badly
 * understates what is about to be killed.
 */
function busyPhrase(names: readonly string[], busyPanes: number): string | null {
  if (busyPanes === 0 && names.length === 0) {
    return null;
  }
  return busyPanes > names.length
    ? `${busyPanes} panes are still running (${names.join(", ")})`
    : names.length === 1
      ? `${names[0]} is still running`
      : `These processes are still running: ${names.join(", ")}`;
}

/**
 * ONE dialog, never two (spec §6).
 *
 * When both a busy agent and unsaved files exist, they are named in a single
 * confirmation. Two sequential dialogs on ⌘Q is worse than either alone: the
 * first one's answer is already forgotten by the time the second appears, and
 * the user cannot see what they are trading against what.
 */
export function confirmMessage(
  names: readonly string[],
  action: string = "Close",
  busyPanes: number = names.length,
  dirtyFiles: readonly string[] = [],
): string {
  const subject = [busyPhrase(names, busyPanes), dirtyFilesPhrase(dirtyFiles)]
    .filter((phrase): phrase is string => phrase !== null)
    .join(", and ");
  return `${subject}. ${action} anyway?`;
}

/**
 * The generic copy for a census that could not name what is running.
 *
 * Exported and shared with `quit-guard.ts` rather than written twice: the
 * unsaved-files clause has to reach both, and two copies of one sentence is
 * exactly how one of them gets it and the other does not.
 */
export function unknownMessage(action: string, dirtyFiles: readonly string[] = []): string {
  const dirty = dirtyFilesPhrase(dirtyFiles);
  const subject =
    dirty === null
      ? "Deck could not verify whether terminal processes are still running"
      : `Deck could not verify whether terminal processes are still running, and ${dirty}`;
  return `${subject}. ${action} anyway?`;
}

let prompting = false;

/**
 * True when closing may proceed. Fetches fresh process info for the target
 * panes (the 2s poll can miss a just-launched process) and shows one native
 * dialog unless every target is explicitly an idle shell AND nothing is
 * unsaved. Unknown inspection uses generic copy; dialog failure returns false.
 * Re-entrant calls while a prompt is open also return false.
 *
 * `dirtyFiles` makes this the single guard for both kinds of surface: a
 * terminal tab guards on busy processes, a file tab on unsaved edits, and a
 * window holding both asks once (spec §6). Closing a file tab passes an empty
 * `paneIds` — there is no pane to inspect, and the dirty list is the whole
 * question.
 */
export async function confirmClose(
  paneIds: readonly number[],
  pty: PtyClient = defaultPtyClient,
  copy: ConfirmCopy = CLOSE_COPY,
  dirtyFiles: readonly string[] = [],
): Promise<boolean> {
  if (prompting) {
    return false;
  }
  prompting = true;
  try {
    const infos = await freshPaneInfo(paneIds, pty);
    if (infos.every((info) => info.kind === "idle-shell") && dirtyFiles.length === 0) {
      return true;
    }
    const names = busyProcesses(infos);
    const fullyNamed = infos.every(
      (info) =>
        info.kind === "idle-shell" ||
        ((info.kind === "agent" || info.kind === "busy") && info.process !== null),
    );
    const message =
      (fullyNamed
        ? confirmMessage(names, copy.action, infos.filter(isBusy).length, dirtyFiles)
        : unknownMessage(copy.action, dirtyFiles)) +
      (copy.detail === undefined ? "" : `\n\n${copy.detail}`);
    try {
      return await ask(message, {
        title: copy.title,
        kind: "warning",
        okLabel: copy.okLabel,
        cancelLabel: "Cancel",
      });
    } catch (err: unknown) {
      console.error("Close prompt failed:", err);
      return false;
    }
  } finally {
    prompting = false;
  }
}
