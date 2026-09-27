/**
 * The previous launch's session, held for the Open Board to offer.
 *
 * Launch no longer reopens tabs on its own (2026-09-27): starting a new day
 * behind a wall of yesterday's agents was the complaint. Boot reads the
 * journal's window records into `lastSession` instead, the Board shows one
 * line for it, and only that line's click runs `restoreSession`. Window-scoped
 * (R5): only the main window ever fills it.
 */
import { signal } from "@preact/signals";
import type { WindowRecord } from "../lib/session-schema";
import { workspaceLabel } from "../lib/workspace-label";

export interface LastSession {
  /** Every window record the previous launch left, handed to `restoreSession`. */
  readonly records: ReadonlyMap<string, WindowRecord>;
  /** The label the records were read for; the others are secondary windows. */
  readonly mainLabel: string;
  readonly tabCount: number;
  /** Distinct workspace names, in record order. */
  readonly workspaces: readonly string[];
}

/** Null when there is nothing to offer, or once the offer was taken or declined. */
export const lastSession = signal<LastSession | null>(null);

/** Null when the records hold no tab — an empty last launch offers nothing. */
export function summarizeLastSession(
  records: ReadonlyMap<string, WindowRecord>,
  mainLabel: string,
): LastSession | null {
  const tabs = [...records.values()].flatMap((record) => record.tabs);
  if (tabs.length === 0) {
    return null;
  }
  const workspaces = new Set(
    tabs.flatMap((tab) => (tab.workspacePath === null ? [] : [workspaceLabel(tab.workspacePath)])),
  );
  return { records, mainLabel, tabCount: tabs.length, workspaces: [...workspaces] };
}
