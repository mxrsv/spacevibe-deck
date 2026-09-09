/**
 * Worktree-card-specific rail modeling: selectable entries, closed-card
 * priority, and checkout ordering. The parent rail model owns tabs/projects;
 * this module owns the card boundary so neither file grows into both domains.
 */
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import type { PaneAgent } from "../lib/process-info";
import type { SignalConfidence } from "../terminal/agent-attention";
import type { RailPaneRow, RailState, RailTabRow } from "./agent-rail-model";

/** One agent pane on a worktree card. */
export interface RailCardPane extends RailPaneRow {
  readonly kind: "agent";
  readonly tabIndex: number;
  /** Empty when the pane/session pairing is not authoritative. */
  readonly model: string;
  /** Unique within its checkout; user names win before numeric ordinals. */
  readonly label: string;
}

/** One tab with no agent pane, retained after the visual tab tier is removed. */
export interface RailCardShell {
  readonly kind: "shell";
  /** `TabView.key`, namespaced from pane ids for list identity. */
  readonly key: string;
  readonly tabIndex: number;
  readonly label: string;
  readonly active: boolean;
}

export type RailCardEntry = RailCardPane | RailCardShell;

export interface RailWorktreeGroup {
  /** Worktree path; unique within a repository. */
  readonly key: string;
  readonly branch: string;
  readonly name: string;
  /** Always the worktree root, never a tab's cwd. */
  readonly path: string;
  /**
   * The REPOSITORY this checkout belongs to — its primary worktree's path,
   * which for the primary checkout is `path` itself.
   *
   * Separate from `path` because `worktree_add` is run against a repository:
   * `Create branch from here` on a linked worktree was passing that worktree,
   * so the create form suggested a destination beside it rather than beside
   * the repository (code review, 2026-08-31).
   */
  readonly repositoryPath: string;
  readonly primary: boolean;
  /** False only for the synthetic group of an unscanned/plain folder. */
  readonly labelled: boolean;
  /** Agent panes plus one shell entry for every shell-only tab. */
  readonly entries: readonly RailCardEntry[];
  readonly panes: readonly RailCardPane[];
  readonly live: boolean;
  readonly age: string;
  /** True when this checkout owns the selected tab, including a shell tab. */
  readonly active: boolean;
  readonly rows: readonly RailTabRow[];
}

/**
 * DL-27.3's fold, loudest first. `ended` sits between `asked` and `working`
 * (2026-09-03): an agent that died is something to look at before a run that
 * is still going, and after a question that is waiting on an answer.
 */
const STATE_RANK: Readonly<Record<RailState, number>> = {
  failed: 5,
  asked: 4,
  ended: 3,
  working: 2,
  done: 1,
  idle: 0,
};

export const STRIP_VISIBLE = 3;

/** Build every selectable card entry and allocate checkout-wide labels. */
export function buildCardEntries(
  rows: readonly RailTabRow[],
  models: ReadonlyMap<number, string> | undefined,
): readonly RailCardEntry[] {
  type AgentDraft = Omit<RailCardPane, "label"> & { readonly baseLabel: string };
  type ShellDraft = Omit<RailCardShell, "label"> & { readonly baseLabel: string };
  type EntryDraft = AgentDraft | ShellDraft;

  const drafts = rows.flatMap<EntryDraft>((row) =>
    row.panes.length === 0
      ? [
          {
            kind: "shell" as const,
            key: `shell:${row.key}`,
            tabIndex: row.index,
            active: row.active,
            baseLabel: row.named ? row.title : "Shell",
          },
        ]
      : row.panes.map((pane) => ({
          ...pane,
          kind: "agent" as const,
          tabIndex: row.index,
          model: models?.get(pane.paneId) ?? "",
          // DL-27.15 / DL-27.21: the pane's own sentence takes its default name.
          baseLabel: row.named ? row.title : pane.message.trim() || displayAgent(pane.agent),
        })),
  );

  // Allocated against the labels ACTUALLY emitted, not against a count of
  // matching base labels (code review, 2026-08-31). Counting occurrences of
  // `baseLabel` produced a collision the moment a base label already ended in
  // a number: two unnamed `claude` panes plus a tab the user named `Claude 2`
  // gave `["Claude", "Claude 2", "Claude 2"]` — the generated ordinal landing
  // on the user's own word. Two rows then carried one name, one `aria-label`
  // and one close label, which is the ambiguity `RailCardPane.label`'s
  // "unique within its checkout" exists to prevent. Skipping a taken label
  // costs one `Set` and keeps first-come ordering: an earlier row never
  // renumbers because a later one wanted its word.
  const taken = new Set<string>();
  return drafts.map((draft): RailCardEntry => {
    const { baseLabel, ...entry } = draft;
    let label = baseLabel;
    for (let ordinal = 2; taken.has(label); ordinal += 1) {
      label = `${baseLabel} ${ordinal}`;
    }
    taken.add(label);
    return { ...entry, label };
  });
}

export function outranks(pane: RailPaneRow, incumbent: RailPaneRow): boolean {
  const delta = STATE_RANK[pane.state] - STATE_RANK[incumbent.state];
  return delta > 0 || (delta === 0 && pane.changedAt > incumbent.changedAt);
}

/** The loudest panes represented on a closed card, without mutating input. */
export function stripSegments(panes: readonly RailCardPane[]): {
  readonly shown: readonly RailCardPane[];
  readonly overflow: number;
} {
  const sorted = [...panes].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));
  return {
    shown: sorted.slice(0, STRIP_VISIBLE),
    overflow: Math.max(0, sorted.length - STRIP_VISIBLE),
  };
}

const PRIMARY_RANK = 0;
const LIVE_RANK = 1;
const HISTORY_ONLY_RANK = 2;

function worktreeRank(group: RailWorktreeGroup): number {
  if (group.primary) {
    return PRIMARY_RANK;
  }
  return group.rows.length > 0 ? LIVE_RANK : HISTORY_ONLY_RANK;
}

function openedIn(group: RailWorktreeGroup): number {
  return group.rows.reduce(
    (oldest, row) => Math.min(oldest, row.openedAt),
    Number.MAX_SAFE_INTEGER,
  );
}

function firstIndexIn(group: RailWorktreeGroup): number {
  return group.rows.reduce((lowest, row) => Math.min(lowest, row.index), Number.MAX_SAFE_INTEGER);
}

/** Primary first, then live checkouts by open order, then history-only. */
export function sortWorktrees(groups: readonly RailWorktreeGroup[]): readonly RailWorktreeGroup[] {
  return [...groups].sort(
    (left, right) =>
      worktreeRank(left) - worktreeRank(right) ||
      openedIn(left) - openedIn(right) ||
      firstIndexIn(left) - firstIndexIn(right),
  );
}

/* ──────────────────────────── how a checkout names itself ───────────────────
 * DL-27.25's head said "checkout plus branch", and for the PRIMARY checkout
 * that is the project name printed twice: `RailWorktreeGroup.name` is the
 * basename of the checkout's own path, and a repository's primary checkout
 * sits at the repository root, so `name === project` by construction. The
 * cluster header above it already said that word.
 *
 * The rule is therefore "state what the tier above did not", and it has to
 * decide the LABEL and the BADGE together — deciding them apart is what let
 * the duplication back in one tier down, where `git worktree add ../fix-login
 * fix-login` produces a checkout whose folder and branch are the same word.
 *
 * Kept out of `buildAgentRail`: `name` stays a FACT ("the basename of this
 * checkout's path"), which `whereOf`, the gallery and the tests all read as
 * one. A label is a display concern, so it lives here as a pure function over
 * the group rather than as a second meaning for a model field.
 */

/** The trailing badge on a checkout head: its branch, or what kind it is. */
export interface CheckoutBadge {
  /** `branch` draws DL-14.1's `GitBranch` glyph; `role` is the word alone. */
  readonly kind: "branch" | "role";
  readonly text: string;
}

/**
 * The word a checkout head is named by: its branch when it is the primary
 * checkout (whose folder name the project header already printed), its own
 * folder name otherwise.
 *
 * Keyed on `primary` rather than on `name === project` so two sibling folders
 * that happen to share a basename cannot make a secondary worktree read as the
 * primary one — and the model already carries the flag.
 */
export function checkoutLabel(group: RailWorktreeGroup): string {
  return group.primary ? group.branch : group.name;
}

/**
 * The badge beside that label, which never restates it.
 *
 * The `Primary` / `Worktree` vocabulary is not new: it is the word the
 * card's own actions menu used to print in its header, moved onto the card
 * when that header came off.
 */
export function checkoutBadge(group: RailWorktreeGroup): CheckoutBadge {
  if (group.primary) {
    return { kind: "role", text: "Primary" };
  }
  // A worktree whose folder is named after its branch — the shape
  // `git worktree add ../fix-login fix-login` produces, and the one this
  // repository's own sibling checkout has. The branch is already the label,
  // so the badge spends itself on the fact that is left.
  return group.branch === group.name
    ? { kind: "role", text: "Worktree" }
    : { kind: "branch", text: group.branch };
}

/* ─────────────────────────── the closed strip, as agent kinds ───────────────
 * Ported from the owner-approved gallery specimen
 * (`src/gallery/sections/strip-actions-model.ts`, parked with its section) per
 * `docs/specs/2026-08-27-rail-card-strip-actions-design.md` §4/§6/§14.
 *
 * `stripSegments` above is kept: it is one pane per segment, which is what a
 * segment MEANT until this change, and the rail-worktree-card gallery specimen
 * and its tests still read it. The card itself now folds by agent kind.
 */

/** One strip segment once segments are agent kinds rather than panes. */
export interface StripGroup {
  /** The agent id; also the segment's identity for hover and for keys. */
  readonly agent: string;
  /** That agent's panes in the checkout, loudest first. */
  readonly panes: readonly RailCardPane[];
  /** The loudest pane's state — the one mark a merged segment can wear. */
  readonly state: RailState;
  /** That pane's confidence in it, so the segment's mark can be drawn hollow too. */
  readonly confidence: SignalConfidence;
}

/**
 * An agent id as a word a person reads — `claude` → `Claude`. Exported since
 * 2026-08-27: a MERGED segment is the first thing that ever needed to name an
 * agent KIND rather than a pane (`2 Claude agents`), so the previously
 * module-private `agentDisplayName` became this.
 */
export function displayAgent(agent: PaneAgent): string {
  const builtin = BUILTIN_AGENTS.find((candidate) => candidate.id === agent);
  return builtin === undefined ? agent : (builtin.label.split(" ")[0] ?? builtin.label);
}

/**
 * Every agent kind in the checkout, loudest group first (spec §4).
 *
 * `outranks` is reused rather than restated — the grouped strip has to rank by
 * exactly DL-27.3's fold (`failed > asked > working > done > idle`, ties by
 * recency), or a merged segment's state mark and its menu's row order would
 * disagree about which pane is loudest.
 *
 * The cost, stated rather than argued (spec §4): a merged segment wears ONE
 * state mark. A checkout running a failed Claude beside a working one shows
 * `failed` and says nothing about the other until the segment menu opens —
 * which is why that menu is not a convenience.
 */
export function groupSegments(panes: readonly RailCardPane[]): readonly StripGroup[] {
  const byAgent = new Map<string, RailCardPane[]>();
  for (const item of panes) {
    byAgent.set(item.agent, [...(byAgent.get(item.agent) ?? []), item]);
  }
  return [...byAgent.entries()]
    .map(([agent, members]) => {
      const sorted = [...members].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));
      // A group with no members cannot exist — every key came from a pane — so
      // falling back to `members` avoids the non-null assertion the type needs.
      const loudest = sorted[0] ?? members[0];
      return {
        agent,
        panes: sorted,
        state: loudest?.state ?? "idle",
        confidence: loudest?.confidence ?? "unknown",
      } satisfies StripGroup;
    })
    .sort((a, b) => {
      const left = a.panes[0];
      const right = b.panes[0];
      if (left === undefined || right === undefined) {
        return 0;
      }
      return outranks(left, right) ? -1 : outranks(right, left) ? 1 : 0;
    });
}

/**
 * Fallback segment widths, MEASURED off the rendered strip on 2026-08-27 in
 * Chrome at the rail's real 276px width — a plain segment 39px, a merged one
 * +21px for its count suffix, the `+` 30px, the `+N` tail 31px. They run ~7px
 * conservative, which folds one segment early rather than one segment late.
 *
 * The shipped fold MEASURES (spec §6/§13): `useStripFit` reads the real boxes
 * and hands them in through `widthOf`. These are what the very first paint of
 * the very first card uses, before any box exists to measure.
 */
export const SEGMENT_WIDTH_FALLBACK = 39;
export const SEGMENT_COUNT_WIDTH = 21;
export const SEGMENT_ADD_WIDTH = 30;
export const SEGMENT_OVERFLOW_WIDTH = 31;

/**
 * What the strip actually has, MEASURED: `.asr-card` is 260px wide, its 9px
 * side padding leaves a 242px content box, and `.asr-card__strip` is indented
 * `margin-left: 22px` to align under the checkout name — so the budget is
 * 220px, not 242px. `useStripFit` measures the real one; this is the fallback.
 */
export const STRIP_BUDGET_FALLBACK = 220;

/** The key a `+N` tail is raised under, distinct from any agent id. */
export const STRIP_OVERFLOW_KEY = "overflow";

export interface StripFit {
  readonly shown: readonly StripGroup[];
  /** Hidden PANES, not hidden groups — `+2` means "two more agents here". */
  readonly overflow: number;
}

/**
 * The fold the `+` forces (spec §6): fold agent KINDS until the segments, the
 * `+N` tail and the `+` all fit the budget. **The `+` is never what folds** —
 * a launcher that vanishes when a checkout gets busy is missing exactly when
 * it is wanted.
 *
 * `widthOf` is injected rather than computed so the rule stays a pure function
 * over measurements the component takes; `budget` likewise.
 */
export function fitSegments(
  groups: readonly StripGroup[],
  panes: readonly RailCardPane[],
  widthOf: (group: StripGroup) => number,
  budget: number = STRIP_BUDGET_FALLBACK,
  addWidth: number = SEGMENT_ADD_WIDTH,
  overflowWidth: number = SEGMENT_OVERFLOW_WIDTH,
): StripFit {
  const total = groups.reduce((sum, group) => sum + widthOf(group), 0);
  if (total + addWidth <= budget) {
    return { shown: groups, overflow: 0 };
  }
  const shown: StripGroup[] = [];
  let used = 0;
  for (const group of groups) {
    if (used + widthOf(group) + overflowWidth + addWidth > budget) {
      break;
    }
    shown.push(group);
    used += widthOf(group);
  }
  const seen = shown.reduce((sum, group) => sum + group.panes.length, 0);
  return { shown, overflow: Math.max(0, panes.length - seen) };
}

/**
 * Every pane the raised segment stands for (spec §5, §14). The `+N` tail
 * raises exactly the panes it hides; an agent key raises that group's panes.
 *
 * Returns an empty list when the key names nothing shown, which is also the
 * signal `useSegmentMenu` reads to close a menu whose segment was re-ranked
 * out from under it (spec §5.1, "pin by key").
 */
export function panesBehind(
  key: string,
  panes: readonly RailCardPane[],
  shown: readonly StripGroup[],
): readonly RailCardPane[] {
  if (key === STRIP_OVERFLOW_KEY) {
    const seen = new Set(shown.flatMap((group) => group.panes.map((pane) => pane.paneId)));
    return panes.filter((pane) => !seen.has(pane.paneId));
  }
  return shown.find((group) => group.agent === key)?.panes ?? [];
}

/* ──────────────────────────── what the actions menu acts on ─────────────────
 * `openspec/changes/rail-create-consolidation` (design D2). The actions menu
 * used to read a whole `RailWorktreeGroup`, which only a rendered card has.
 * `⌘T` raises the same menu FREE-STANDING for the active tab's workspace, and
 * `App` holds no groups — it holds a path and the same scans the rail reads —
 * so the menu takes this SUBSET instead, and both placements build it: a card
 * through `subjectOf`, the chord through `subjectForWorkspace` in
 * `agent-rail-model.ts`. The menu stays pure over its inputs either way.
 */

export interface MenuSubject {
  /** The project name the cluster header prints — `RailStreamGroup.project`. */
  readonly project: string;
  /** The checkout root the menu's rows act on; never a tab's cwd. */
  readonly path: string;
  /** The repository — `worktree_add`'s argument; `path` itself for the primary. */
  readonly repositoryPath: string;
  /** Null when git does not know the checkout: a plain folder, and every
   *  workspace under Tauri, where `git_repository` does not exist. */
  readonly branch: string | null;
  /** The checkout's own word — `checkoutLabel`'s answer for a scanned checkout,
   *  the folder's basename otherwise. */
  readonly label: string;
  /** Mirrors `RailWorktreeGroup.labelled`: false for the synthetic worktree of a
   *  folder git does not know, which drops every git-backed row. */
  readonly labelled: boolean;
}

/** The subject a card's menu acts on — the card's own group, reduced. */
export function subjectOf(project: string, group: RailWorktreeGroup): MenuSubject {
  return {
    project,
    path: group.path,
    repositoryPath: group.repositoryPath,
    branch: group.labelled && group.branch !== "" ? group.branch : null,
    label: checkoutLabel(group),
    labelled: group.labelled,
  };
}

/**
 * `project · label · branch`, with a segment already said dropped — the rule
 * `whereOf` has applied to every accessible name and tooltip since 2026-08-30,
 * stated once here so the card row's `whereOf` and the free-standing menu's
 * heading can never disagree about the words. A repository's primary checkout
 * sits at the repository root, so its label (the branch) and the project can
 * still collide with the branch; a worktree named after its branch collides
 * the other way. Both come out as one word.
 */
export function subjectWhere(subject: MenuSubject): string {
  const said: string[] = [];
  for (const segment of [subject.project, subject.label, subject.branch ?? ""]) {
    if (segment !== "" && !said.includes(segment)) {
      said.push(segment);
    }
  }
  return said.join(" · ");
}
