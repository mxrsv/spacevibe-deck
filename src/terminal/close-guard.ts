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

export function confirmMessage(
  names: readonly string[],
  action: string = "Close",
): string {
  return names.length === 1
    ? `${names[0]} is still running. ${action} anyway?`
    : `These processes are still running: ${names.join(", ")}. ${action} anyway?`;
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
    const message = fullyNamed
      ? confirmMessage(names, copy.action)
      : unknownMessage(copy.action);
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
