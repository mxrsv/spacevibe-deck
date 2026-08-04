import { ask } from "@tauri-apps/plugin-dialog";
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
    if (
      isBusy(info) &&
      info.process !== null &&
      !names.includes(info.process)
    ) {
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

export const QUIT_COPY: ConfirmCopy = {
  title: "Quit Deck",
  okLabel: "Quit",
  action: "Quit",
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

/**
 * `busyPanes` is the count of panes, not of names: three panes all running
 * `claude` deduplicate to one name, and "claude is still running" badly
 * understates what is about to be killed.
 */
export function confirmMessage(
  names: readonly string[],
  action: string = "Close",
  busyPanes: number = names.length,
): string {
  const subject =
    busyPanes > names.length
      ? `${busyPanes} panes are still running (${names.join(", ")})`
      : names.length === 1
        ? `${names[0]} is still running`
        : `These processes are still running: ${names.join(", ")}`;
  return `${subject}. ${action} anyway?`;
}

function unknownMessage(action: string): string {
  return `Deck could not verify whether terminal processes are still running. ${action} anyway?`;
}

let prompting = false;

/**
 * True when closing may proceed. Fetches fresh process info for the target
 * panes (the 2s poll can miss a just-launched process) and shows one native
 * dialog unless every target is explicitly an idle shell. Unknown inspection
 * uses generic copy; dialog failure returns false. Re-entrant calls while a
 * prompt is open also return false.
 */
export async function confirmClose(
  paneIds: readonly number[],
  pty: PtyClient = defaultPtyClient,
  copy: ConfirmCopy = CLOSE_COPY,
): Promise<boolean> {
  if (prompting) {
    return false;
  }
  prompting = true;
  try {
    const infos = await freshPaneInfo(paneIds, pty);
    if (infos.every((info) => info.kind === "idle-shell")) {
      return true;
    }
    const names = busyProcesses(infos);
    const fullyNamed = infos.every(
      (info) =>
        info.kind === "idle-shell" ||
        ((info.kind === "agent" || info.kind === "busy") &&
          info.process !== null),
    );
    const message =
      (fullyNamed
        ? confirmMessage(names, copy.action, infos.filter(isBusy).length)
        : unknownMessage(copy.action)) +
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
