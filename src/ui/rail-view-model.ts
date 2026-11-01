/**
 * The project-first rail's organizing layer (spec LAY-1, LAY-3, LAY-4): which
 * rows the rail shows, in which groups and in what order.
 *
 * Pure, over `buildAgentRail`'s stream rather than `tabViews`, so project
 * identity, the longest-prefix attach and the project order stay decided once,
 * in `agent-rail-model.ts`. The session's marks come in as a `RailViewState`
 * (`rail-view-state.ts`); the clock is a parameter.
 */
import type { SignalConfidence } from "../terminal/agent-attention";
import { checkoutLine, type RailCardEntry, type RailWorktreeGroup } from "./agent-rail-card-model";
import type { AgentRailView, RailPaneRow } from "./agent-rail-model";
import type { RailViewState } from "./rail-view-state";

/**
 * `RailState` with `asked` split by what it waits for (LAY-4): `needs-input` is
 * a question, a permission wait or a warning; `unread` is a finished run nobody
 * has looked at, latched until the pane is focused. The shipped rail keeps the
 * folded word and its one yellow mark.
 */
export type RailStatus =
  "failed" | "needs-input" | "unread" | "ended" | "working" | "done" | "idle";

/** One row of the rail: an agent pane, or a tab with no agent in it. */
export interface RailItem {
  /** `pane:<paneId>`, or the shell entry's `shell:<tabKey>`: what a pin or archive names. */
  readonly id: string;
  /** `RailStreamGroup.orderKey`, which survives the project's last tab closing. */
  readonly projectKey: string;
  readonly project: string;
  /** The checkout's branch, or the folder's name when git does not know it (LAY-2). */
  readonly branch: string;
  /**
   * The user's tab name, else the agent's newest sentence, else the session's
   * first prompt or the agent's name (LAY-2).
   */
  readonly title: string;
  readonly status: RailStatus;
  readonly confidence: SignalConfidence;
  /** When the state last changed; 0 for a shell tab or a pane never seen to change. */
  readonly changedAt: number;
  readonly entry: RailCardEntry;
  readonly checkout: RailWorktreeGroup;
}

export interface RailProject {
  /** `RailStreamGroup.orderKey`. */
  readonly key: string;
  readonly name: string;
}

export interface RailGroup {
  /** The project's key, or the status or time bucket's id. */
  readonly key: string;
  /** The project's name, or the bucket's label. */
  readonly label: string;
  /** The rows to draw, in order: search applied, archived and hidden left out. */
  readonly items: readonly RailItem[];
  /** A project's unarchived rows whatever the search says; a bucket's own rows. */
  readonly count: number;
  /** What a folded project speaks with (LAY-1); null for a quiet project and for buckets. */
  readonly rollup: RailItem | null;
}

export interface RailViewModel {
  /**
   * By project: every shown project in stream order, a project with no row
   * matching the search left out. Otherwise the non-empty buckets.
   */
  readonly groups: readonly RailGroup[];
  /** Every archived row, hidden projects' included. */
  readonly archived: readonly RailItem[];
  readonly hidden: readonly RailProject[];
}

/**
 * Loudest first, for the roll-up and the Priority sort alike. Not
 * `STATE_RANK`: there `ended` outranks `working`, while a folded project only
 * ever speaks with these four (LAY-1) and every other state ties at zero.
 */
const LOUDNESS: Readonly<Record<RailStatus, number>> = {
  failed: 4,
  "needs-input": 3,
  working: 2,
  unread: 1,
  ended: 0,
  done: 0,
  idle: 0,
};

const STATUS_BUCKETS: readonly {
  readonly key: string;
  readonly label: string;
  readonly holds: readonly RailStatus[];
}[] = [
  { key: "needs-you", label: "Needs you", holds: ["failed", "needs-input"] },
  { key: "unread", label: "Unread", holds: ["unread"] },
  { key: "working", label: "Working", holds: ["working"] },
  { key: "quiet", label: "Quiet", holds: ["ended", "done", "idle"] },
];

const MINUTE = 60_000;
const EARLIER = "earlier";

/** Time in the current state, newest first; the last bucket takes the rest. */
const TIME_BUCKETS: readonly {
  readonly key: string;
  readonly label: string;
  readonly within: number;
}[] = [
  { key: "last-5m", label: "Last 5 minutes", within: 5 * MINUTE },
  { key: "last-15m", label: "Last 15 minutes", within: 15 * MINUTE },
  { key: EARLIER, label: "Earlier", within: Number.POSITIVE_INFINITY },
];

/** The split status of one agent pane row. */
export function railStatus(pane: Pick<RailPaneRow, "state" | "attention">): RailStatus {
  if (pane.state !== "asked") {
    return pane.state;
  }
  // An `asked` row without attention predates the field: read it as the
  // louder half, so a missing field never quiets a question.
  return pane.attention === "completed" ? "unread" : "needs-input";
}

function itemOf(
  projectKey: string,
  project: string,
  checkout: RailWorktreeGroup,
  entry: RailCardEntry,
): RailItem {
  const place = { projectKey, project, branch: checkoutLine(checkout).name, entry, checkout };
  if (entry.kind === "shell") {
    // No agent, so no state; it stays a row because every open tab has one.
    return {
      ...place,
      id: entry.key,
      title: entry.label,
      status: "idle",
      confidence: "unknown",
      changedAt: 0,
    };
  }
  const said = entry.message.trim() !== "";
  return {
    ...place,
    id: `pane:${entry.paneId}`,
    title: entry.tabName ?? (said ? entry.sentence : entry.taskLabel) ?? entry.label,
    status: railStatus(entry),
    // An absent confidence is today's filled mark, as `RailPaneRow` says.
    confidence: entry.confidence ?? "explicit",
    changedAt: entry.changedAt,
  };
}

/** Every row of the stream, in stream order: project, checkout, then entry order. */
export function railItems(view: AgentRailView): readonly RailItem[] {
  return view.stream.flatMap((group) =>
    group.worktrees.flatMap((checkout) =>
      checkout.entries.map((entry) => itemOf(group.orderKey, group.project, checkout, entry)),
    ),
  );
}

/** The loudest row, newest first on a tie; null when none is loud (LAY-1). */
export function projectRollup(items: readonly RailItem[]): RailItem | null {
  let loudest: RailItem | null = null;
  for (const item of items) {
    const rank = LOUDNESS[item.status];
    if (rank === 0) {
      continue;
    }
    const delta = loudest === null ? 1 : rank - LOUDNESS[loudest.status];
    if (delta > 0 || (delta === 0 && item.changedAt > (loudest?.changedAt ?? 0))) {
      loudest = item;
    }
  }
  return loudest;
}

/** Case-insensitive subsequence match, whitespace ignored: `tkrf` finds `token refresh`. */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  const text = haystack.toLowerCase();
  let from = 0;
  for (const char of needle.toLowerCase().replace(/\s+/g, "")) {
    const at = text.indexOf(char, from);
    if (at === -1) {
      return false;
    }
    from = at + 1;
  }
  return true;
}

function matchesQuery(item: RailItem, query: string): boolean {
  return fuzzyMatch(query, `${item.title} ${item.branch} ${item.project}`);
}

/**
 * Pinned first, then newest first, or loudest then newest under Priority.
 * `Array.prototype.sort` is stable, so a tie keeps stream order.
 */
function sortItems(items: readonly RailItem[], state: RailViewState): readonly RailItem[] {
  const pinned = (item: RailItem) => Number(state.pinned.has(item.id));
  const loudness = (item: RailItem) => (state.sorting === "priority" ? LOUDNESS[item.status] : 0);
  return [...items].sort(
    (left, right) =>
      pinned(right) - pinned(left) ||
      loudness(right) - loudness(left) ||
      right.changedAt - left.changedAt,
  );
}

function timeBucket(item: RailItem, now: number): string {
  const age = Math.max(0, now - item.changedAt);
  // A row never seen to change has no time in state; it reads as the oldest.
  const bucket = item.changedAt === 0 ? undefined : TIME_BUCKETS.find((at) => age < at.within);
  return bucket?.key ?? EARLIER;
}

/** The status or time buckets over already ordered rows, empty ones left out. */
function bucketGroups(
  visible: readonly RailItem[],
  grouping: "status" | "time",
  now: number,
): RailGroup[] {
  const buckets: readonly { readonly key: string; readonly label: string }[] =
    grouping === "status" ? STATUS_BUCKETS : TIME_BUCKETS;
  const keyOf = (item: RailItem) =>
    grouping === "status"
      ? STATUS_BUCKETS.find((bucket) => bucket.holds.includes(item.status))?.key
      : timeBucket(item, now);
  return buckets
    .map((bucket) => {
      const held = visible.filter((item) => keyOf(item) === bucket.key);
      return { ...bucket, items: held, count: held.length, rollup: null };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * One project per `orderKey`, in stream order. Two stream groups can share a
 * key — a live cluster and a remembered one for the same repository (see
 * `applyRailOrder`) — and the project-first rail lists that repository once,
 * so the first writer names it and the rows of both fall under it.
 */
function railProjects(view: AgentRailView): readonly RailProject[] {
  const byKey = new Map<string, RailProject>();
  for (const group of view.stream) {
    if (!byKey.has(group.orderKey)) {
      byKey.set(group.orderKey, { key: group.orderKey, name: group.project });
    }
  }
  return [...byKey.values()];
}

/** Group, sort, search and partition the stream under the session's marks. */
export function buildRailView(
  view: AgentRailView,
  state: RailViewState,
  now: number,
): RailViewModel {
  const items = railItems(view);
  const projects = railProjects(view);
  const unarchived = items.filter((item) => !state.archived.has(item.id));
  const visible = sortItems(
    unarchived.filter(
      (item) => !state.hidden.has(item.projectKey) && matchesQuery(item, state.query),
    ),
    state,
  );
  const searching = state.query.trim() !== "";
  const groups =
    state.grouping === "project"
      ? projects
          .filter((project) => !state.hidden.has(project.key))
          .map((project) => {
            const own = unarchived.filter((item) => item.projectKey === project.key);
            return {
              key: project.key,
              label: project.name,
              items: visible.filter((item) => item.projectKey === project.key),
              count: own.length,
              rollup: projectRollup(own),
            };
          })
          .filter((group) => !searching || group.items.length > 0)
      : bucketGroups(visible, state.grouping, now);
  return {
    groups,
    archived: sortItems(
      items.filter((item) => state.archived.has(item.id)),
      state,
    ),
    hidden: projects.filter((project) => state.hidden.has(project.key)),
  };
}
