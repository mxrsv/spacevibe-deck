import type { Tree, TreePane } from "@protocol/tree";

/** The Needs you section pins this many panes; the rest are behind "See all" (MOB16). */
export const PINNED_MAX = 3;

export interface DesktopTreeView {
  readonly id: string;
  readonly name: string;
  /** Null for a desktop that is not online: its last tree is not a claim about now. */
  readonly tree: Tree | null;
}

export interface NeedsItem {
  readonly desktopId: string;
  readonly desktopName: string;
  readonly project: string;
  readonly checkout: string;
  readonly pane: TreePane;
}

export interface NeedsYou {
  /** Every waiting pane, newest first: the pager order of the pane screen too. */
  readonly all: readonly NeedsItem[];
  readonly pinned: readonly NeedsItem[];
  /** How many more than the pinned ones; "See all" shows when this is above zero. */
  readonly more: number;
}

export function isWaiting(pane: TreePane): boolean {
  return pane.attention === "requested" || pane.attention === "error";
}

/** Panes whose attention is `requested` or `error` across all desktops, newest `attentionSince` first. */
export function selectNeedsYou(desktops: readonly DesktopTreeView[]): NeedsYou {
  const all: NeedsItem[] = [];
  for (const desktop of desktops) {
    for (const project of desktop.tree?.projects ?? []) {
      for (const checkout of project.checkouts) {
        for (const pane of checkout.panes) {
          if (!isWaiting(pane)) continue;
          all.push({
            desktopId: desktop.id,
            desktopName: desktop.name,
            project: project.name,
            checkout: checkout.name,
            pane,
          });
        }
      }
    }
  }
  // A pane with no start time sorts last; ties keep desktop order (a stable sort).
  all.sort((a, b) => (b.pane.attentionSince ?? -1) - (a.pane.attentionSince ?? -1));
  return { all, pinned: all.slice(0, PINNED_MAX), more: Math.max(0, all.length - PINNED_MAX) };
}

/** A string that changes when a pane's screen may have: the cue to read it again. */
export function paneSignature(pane: TreePane): string {
  return `${pane.attention}|${pane.attentionSince ?? ""}|${pane.lastOutputAt ?? ""}|${pane.lastLine}`;
}
