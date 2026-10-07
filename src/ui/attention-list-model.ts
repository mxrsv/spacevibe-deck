/**
 * What the strip's needs-you chip lists: the panes of `AgentRailView` that are
 * `failed` or `asked`, loudest first, and a count of everything else.
 *
 * Pure, and built on the rail's own projection rather than a second reading of
 * `tabViews`: the state, its confidence, the contract-layer detail and the
 * checkout a pane sits in are decisions `buildAgentRail` already took
 * (`docs/internals/agent-rail.md`), so the chip cannot disagree with the rail
 * beside it about which pane needs you. Nothing here calls `Date.now`; the age
 * is the string the rail already formatted from its injected clock.
 *
 * Listed: `failed` and `asked` — `asked` is the rail's fold of a question, a
 * permission wait, a warning and a finished run nobody has checked (DL-27.3).
 * Counted, never listed: `working`, `done`, `idle` and `ended` (DL-27.26).
 */
import type { PaneAgent } from "../lib/process-info";
import type { SignalConfidence } from "../terminal/agent-attention";
import { displayAgent } from "./agent-rail-card-model";
import type { AgentRailView, RailState, RailStreamGroup } from "./agent-rail-model";

/** The two rail states the chip lists. */
export type AttentionState = Extract<RailState, "failed" | "asked">;

/** One pane that needs the user, in the words the popover prints. */
export interface AttentionEntry {
  /** List identity: the pane id, which survives the pane changing state. */
  readonly key: number;
  /** The coordinate `TabManager.activateForAttention` takes, with `tabIndex`. */
  readonly paneId: number;
  readonly tabIndex: number;
  readonly agent: PaneAgent;
  readonly state: AttentionState;
  readonly confidence: SignalConfidence;
  /**
   * Deck read this off output timing or the process table rather than being
   * told by the CLI (DL-27.3). The popover says so in words.
   */
  readonly inferred: boolean;
  /**
   * Why the pane is listed: the rail's word for the state (`Failed`,
   * `Needs you`), then what a contract-layer source says it waits on
   * (`Needs you — permission prompt`). The rail folds a question, a warning
   * and an unchecked finish into `asked`, so this cannot tell those apart.
   */
  readonly reason: string;
  /** The space (tab) the pane is in: the user's name for it, else its folder. */
  readonly space: string;
  /** The checkout's branch; null for a folder git does not know. */
  readonly branch: string | null;
  /** `space · branch`, with a word already said left out. */
  readonly place: string;
  /**
   * Short relative time since the tracker last saw this pane's state change,
   * or empty when it never has. That is the tracker's `changedAt`, the same
   * clock the rail prints as the pane's age — it can post-date the moment the
   * attention was first latched if something else about the pane changed since.
   */
  readonly age: string;
  /** The rail's unique name for the pane, for the accessible name. */
  readonly label: string;
}

/** Panes the chip counts without listing, by rail state. */
export interface AttentionFooter {
  readonly working: number;
  readonly done: number;
  readonly idle: number;
  readonly ended: number;
}

export interface AttentionList {
  /** Failed first, then asked, then inferred asks; oldest first within each. */
  readonly entries: readonly AttentionEntry[];
  /** The `failed` share of `entries`, which colours the chip's dot red. */
  readonly failedCount: number;
  readonly footer: AttentionFooter;
}

const REASON_WORD: Readonly<Record<AttentionState, string>> = {
  failed: "Failed",
  asked: "Needs you",
};

/** An entry with the tracker clock it is ordered by, which the popover never prints. */
interface Ranked {
  readonly entry: AttentionEntry;
  readonly changedAt: number;
}

/** How loud an entry is: lower sorts first. */
function loudness(entry: AttentionEntry): number {
  if (entry.state === "failed") {
    return 0;
  }
  return entry.inferred ? 2 : 1;
}

/**
 * Longest wait first (`tracker.actionable()`'s own tie-break), with a pane the
 * tracker has never seen change (`changedAt` 0) after the ones it has dated.
 */
function waited(left: Ranked, right: Ranked): number {
  const leftAt = left.changedAt === 0 ? Number.POSITIVE_INFINITY : left.changedAt;
  const rightAt = right.changedAt === 0 ? Number.POSITIVE_INFINITY : right.changedAt;
  if (leftAt === rightAt) {
    return 0;
  }
  return leftAt < rightAt ? -1 : 1;
}

/** The tab and pane ids make the order total, so two renders of one view agree. */
function byLoudness(left: Ranked, right: Ranked): number {
  return (
    loudness(left.entry) - loudness(right.entry) ||
    waited(left, right) ||
    left.entry.tabIndex - right.entry.tabIndex ||
    left.entry.paneId - right.entry.paneId
  );
}

function placeOf(space: string, branch: string | null): string {
  return branch === null || branch === space ? space : `${space} · ${branch}`;
}

function rankedIn(group: RailStreamGroup): Ranked[] {
  const found: Ranked[] = [];
  for (const worktree of group.worktrees) {
    const titles = new Map(worktree.rows.map((row) => [row.index, row.title]));
    const branch = worktree.labelled && worktree.branch !== "" ? worktree.branch : null;
    for (const pane of worktree.panes) {
      if (pane.state !== "failed" && pane.state !== "asked") {
        continue;
      }
      const space = titles.get(pane.tabIndex) ?? group.project;
      const word = REASON_WORD[pane.state];
      const detail = typeof pane.detail === "string" ? pane.detail : "";
      const confidence = pane.confidence ?? "explicit";
      found.push({
        changedAt: pane.changedAt,
        entry: {
          key: pane.paneId,
          paneId: pane.paneId,
          tabIndex: pane.tabIndex,
          agent: pane.agent,
          state: pane.state,
          confidence,
          inferred: confidence === "inferred",
          reason: pane.state === "asked" && detail !== "" ? `${word} — ${detail}` : word,
          space,
          branch,
          place: placeOf(space, branch),
          age: pane.age,
          label: pane.label,
        },
      });
    }
  }
  return found;
}

/**
 * The popover's entries and footer for one render of the rail.
 *
 * It reads each worktree's agent panes, which are the rows the rail draws, so a
 * shell pane or a tab with no agent is never counted. A remembered project has
 * no rows and so contributes nothing.
 */
export function buildAttentionList(view: AgentRailView): AttentionList {
  const ranked: Ranked[] = [];
  const footer = { working: 0, done: 0, idle: 0, ended: 0 };
  for (const group of view.stream) {
    ranked.push(...rankedIn(group));
    for (const worktree of group.worktrees) {
      for (const pane of worktree.panes) {
        if (pane.state !== "failed" && pane.state !== "asked") {
          footer[pane.state] += 1;
        }
      }
    }
  }
  const entries = ranked.sort(byLoudness).map(({ entry }) => entry);
  return {
    entries,
    failedCount: entries.filter((entry) => entry.state === "failed").length,
    footer,
  };
}

/**
 * `2 working · 1 done · 4 idle` — the footer's one line, a state left out when
 * nothing is in it and the whole line empty when no agent is running at all.
 */
export function attentionFooterText(footer: AttentionFooter): string {
  return (["working", "done", "idle", "ended"] as const)
    .filter((state) => footer[state] > 0)
    .map((state) => `${footer[state]} ${state}`)
    .join(" · ");
}

/**
 * The popover row's accessible name: the rail's own pane label, the reason, the
 * doubt where it changes the meaning (DL-27.3) and where the pane is.
 */
export function attentionEntryName(entry: AttentionEntry): string {
  const reason = entry.reason.toLowerCase();
  const state = entry.inferred ? `${reason} (inferred)` : reason;
  return `Focus ${entry.label || displayAgent(entry.agent)}, ${state} in ${entry.place}`;
}
