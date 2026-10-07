/**
 * Checkout-specific rail modeling: selectable entries, their labels, and
 * checkout ordering and naming. The parent rail model owns tabs/projects;
 * this module owns the checkout boundary so neither file grows into both domains.
 */
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import type { PaneAgent } from "../lib/process-info";
import { SESSION_AGENTS, type SessionEntry } from "../lib/session-history";
import { NO_PANES, type TabView } from "../terminal/tabs-store";
import type { RailPaneRow, RailState, RailTabRow } from "./agent-rail-model";

/** One agent pane on a worktree card. */
export interface RailCardPane extends RailPaneRow {
  readonly kind: "agent";
  readonly tabIndex: number;
  /** Empty when the pane/session pairing is not authoritative. */
  readonly model: string;
  /**
   * Unique within its checkout, and the row's accessible name. An unnamed
   * tab's pane is its `sentence`; a named tab's is `name · sentence`, so the
   * ordinal that keeps rows apart lands on the sentence and never on a name.
   */
  readonly label: string;
  /**
   * The name the user gave this pane's tab (DL-35.3); null or absent while
   * unnamed. Optional, like `TabView.panes`: `buildCardEntries` always sets
   * it, and a fixture that predates the field reads as unnamed.
   */
  readonly tabName?: string | null;
  /** The pane's own words: its newest turn, else its agent's name. Absent = `label`. */
  readonly sentence?: string;
  /**
   * The row's first line (DL-27.28): the tab name, else the session's first
   * prompt, else the agent label — carrying the checkout's ordinal when two
   * rows would otherwise read alike. Absent = `label`.
   */
  readonly taskLabel?: string;
  /**
   * The row's second line (DL-27.28, amended 2026-10-07): the agent label ·
   * the status, where the status is the newest turn or, before one, the state
   * word (`stateWord`). When the task label already is the agent label it is
   * the status alone. Never empty on a built entry; absent on a hand-made
   * fixture, which the row then reads as the state word.
   */
  readonly secondLine?: string;
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

/**
 * The session's first prompt per agent pane (RAIL3, DL-27.28) — the only
 * "title" Deck reads (`SessionEntry.title`, Claude Code and Codex only),
 * joined on the pane's contract-layer `sessionId`, never on a guessed pairing.
 * Whitespace collapses so a multi-line prompt reads as one line.
 */
export function sessionTitlesFor(
  tabs: readonly TabView[],
  entries: readonly SessionEntry[],
): ReadonlyMap<number, string> {
  const byId = new Map(entries.map((entry) => [entry.sessionId, entry]));
  const titles = new Map<number, string>();
  for (const pane of tabs.flatMap((tab) => tab.panes ?? NO_PANES)) {
    const entry = pane.sessionId ? byId.get(pane.sessionId) : undefined;
    const title = entry?.title?.replace(/\s+/g, " ").trim();
    if (entry !== undefined && entry.agent === pane.agent && title) {
      titles.set(pane.paneId, title);
    }
  }
  return titles;
}

const STATE_WORD: Readonly<Record<RailState, string>> = {
  failed: "Failed",
  asked: "Needs you",
  ended: "Ended",
  working: "Working",
  done: "Finished",
  idle: "Ready",
};

/**
 * The state as a word for a row's second line (DL-27.2, amended 2026-10-07),
 * used when the agent has no turn to quote. A contract `detail` replaces the
 * `asked` word, a non-zero exit code names itself, and an idle pane the
 * tracker has seen nothing from (`unknown`) says so rather than `Ready`.
 */
export function stateWord(
  pane: Pick<RailPaneRow, "state" | "confidence" | "detail" | "exitCode">,
): string {
  const { state, detail, exitCode } = pane;
  if (state === "asked" && typeof detail === "string" && detail !== "") {
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  if (state === "ended" && typeof exitCode === "number" && exitCode !== 0) {
    return `Exited ${exitCode}`;
  }
  return state === "idle" && pane.confidence === "unknown" ? "No signal" : STATE_WORD[state];
}

/**
 * Session ids of agent panes in unnamed tabs — the panes whose first line
 * would read a first prompt. The rail asks the session list for these (A2).
 */
export function untitledSessionIds(tabs: readonly TabView[]): readonly string[] {
  return tabs.flatMap((tab) =>
    tab.name
      ? []
      : (tab.panes ?? NO_PANES).flatMap((pane) =>
          pane.sessionId && SESSION_AGENTS.some((agent) => agent === pane.agent)
            ? [pane.sessionId]
            : [],
        ),
  );
}

/** Build every selectable card entry and allocate checkout-wide labels. */
export function buildCardEntries(
  rows: readonly RailTabRow[],
  models: ReadonlyMap<number, string> | undefined,
  titles?: ReadonlyMap<number, string>,
): readonly RailCardEntry[] {
  type AgentDraft = Omit<RailCardPane, "label" | "sentence"> & {
    readonly baseSentence: string;
    readonly said: boolean;
    readonly title: string | null;
  };
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
          tabName: row.named ? row.title : null,
          title: row.named ? null : (titles?.get(pane.paneId) ?? null),
          // DL-27.15: the pane's own sentence, whether or not its tab is named.
          baseSentence: pane.message.trim() || displayAgent(pane.agent),
          said: pane.message.trim() !== "",
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
  const claim = (prefix: string, base: string): string => {
    let word = base;
    for (let ordinal = 2; taken.has(prefix + word); ordinal += 1) {
      word = `${base} ${ordinal}`;
    }
    taken.add(prefix + word);
    return word;
  };
  return drafts.map((draft): RailCardEntry => {
    if ("baseLabel" in draft) {
      const { baseLabel, ...shell } = draft;
      return { ...shell, label: claim("", baseLabel) };
    }
    // A named tab's ordinal goes on the sentence, so a name never reads
    // `auth 2` (DL-27.15, amended for named tabs). A first prompt is the
    // user's words too, so it is a task label on the same terms (DL-27.28).
    const { baseSentence, said, title, ...pane } = draft;
    const task = pane.tabName ?? title;
    const prefix = task === null ? "" : `${task} · `;
    const sentence = claim(prefix, baseSentence);
    const agent = displayAgent(pane.agent);
    // DL-27.28's two lines. Without a task the first line is the agent label —
    // or, before the agent has spoken, the claimed sentence, which is that
    // label with the ordinal that keeps two silent rows apart — and the second
    // is the status alone. With a task the second is `agent · status`; a silent
    // row's agent word is the claimed sentence for the same ordinal reason.
    const word = stateWord(pane);
    const lines =
      task === null
        ? { taskLabel: said ? agent : sentence, secondLine: said ? sentence : word }
        : { taskLabel: task, secondLine: `${said ? agent : sentence} · ${said ? sentence : word}` };
    return { ...pane, sentence, label: prefix + sentence, ...lines };
  });
}

export function outranks(pane: RailPaneRow, incumbent: RailPaneRow): boolean {
  const delta = STATE_RANK[pane.state] - STATE_RANK[incumbent.state];
  return delta > 0 || (delta === 0 && pane.changedAt > incumbent.changedAt);
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
 * A checkout's label line in the rail tree (DL-27.28): its branch, tagged
 * `worktree` when it is a linked worktree. A folder git does not know has no
 * branch, so it keeps its folder name and DL-27.23's `folder` word — the
 * project header above already printed that name, and the tag is what says
 * no repository stands behind it.
 *
 * Separate from `checkoutLabel`, which names a checkout in accessible names
 * and on the Agent Board: a linked worktree there is still its folder.
 */
export interface CheckoutLine {
  readonly name: string;
  readonly tag: "worktree" | "folder" | null;
}

export function checkoutLine(group: RailWorktreeGroup): CheckoutLine {
  if (!group.labelled) {
    return { name: group.name, tag: "folder" };
  }
  return { name: group.branch, tag: group.primary ? null : "worktree" };
}

/**
 * An agent id as a word a person reads — `claude` → `Claude`.
 */
export function displayAgent(agent: PaneAgent): string {
  const builtin = BUILTIN_AGENTS.find((candidate) => candidate.id === agent);
  return builtin === undefined ? agent : (builtin.label.split(" ")[0] ?? builtin.label);
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
