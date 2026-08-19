import type { Preset } from "../lib/preset-schema";
import type { SerializedNode } from "../lib/split-tree";
import type { ArchiveEntry } from "../lib/session-schema";
import type { AgentAttentionSummary, PaneView, StatusInfo, TabView } from "../terminal/tabs-store";

/**
 * Canned state the chrome specimens render against.
 *
 * Chosen to cover the states a screenshot of the running app rarely shows all
 * at once: a renamed tab beside a process-derived one, every attention kind,
 * an unread tab, and a split layout deep enough for the preset thumbnail to
 * have something to draw. Nothing here is loaded from disk — the gallery is
 * not allowed to read or write the user's real stores.
 */

const HOME = "/Users/deck";

export const SEED_HOME = HOME;

/** In-memory Deck history for rail specimens; never touches the real store. */
export const SEED_WORKSPACE_HISTORY: readonly string[] = [
  `${HOME}/spacevibe-deck`,
  `${HOME}/deck-worktrees/electron-migration`,
  `${HOME}/deck-worktrees/redesign`,
  `${HOME}/spacevibe-api`,
  `${HOME}/api-worktrees/billing`,
  `${HOME}/spacevibe-hub`,
  `${HOME}/scratch`,
];

/**
 * In-memory archive for rail specimens; never touches the real store.
 *
 * Keyed to `deck-worktrees/electron-migration` — a worktree `host-stub.ts`
 * scans as a real, unlocked, unprunable repository, and one `SEED_TABS` never
 * opens a tab in. That combination is what the rail's `resumable` state
 * requires (`repository-model.ts`'s `resumableWorktreePaths`): an archived
 * entry with no live tab covering the same path.
 */
export const SEED_SESSION_ARCHIVE: Readonly<Record<string, ArchiveEntry>> = {
  [`${HOME}/deck-worktrees/electron-migration`]: {
    savedAt: Date.now(),
    tabs: [
      {
        workspacePath: `${HOME}/deck-worktrees/electron-migration`,
        layout: { type: "leaf" },
        panes: [
          {
            cwd: `${HOME}/deck-worktrees/electron-migration`,
            agent: "claude",
          },
        ],
        name: null,
        dotColor: null,
      },
    ],
  },
};

function attention(
  kind: AgentAttentionSummary["kind"],
  counts: Partial<Omit<AgentAttentionSummary, "kind">> = {},
): AgentAttentionSummary {
  return {
    kind,
    actionableCount: counts.actionableCount ?? 0,
    workingCount: counts.workingCount ?? 0,
    unreadCount: counts.unreadCount ?? 0,
  };
}

const SEEDED_AT = Date.now();

/** `PaneView.changedAt` for a state that settled this many minutes ago. */
const minutesAgo = (minutes: number): number => SEEDED_AT - minutes * 60_000;

/**
 * One seeded pane. The agent rail reads the PANE projection, not the per-tab
 * rollup: its chips, ages and the five DL-27.3 states all come from
 * `attention`/`phase`/`changedAt` here, so every tab below carries panes that
 * agree with its summary.
 */
function pane(
  paneId: number,
  agent: PaneView["agent"],
  attentionValue: PaneView["attention"],
  phase: PaneView["phase"],
  changedAt: number,
  // Quiet panes split on this: true renders `done` (green check), false
  // renders `idle` (ring with a core).
  hasRun = false,
): PaneView {
  return { paneId, agent, attention: attentionValue, phase, hasRun, changedAt };
}

export const SEED_TABS: readonly TabView[] = [
  {
    key: 1,
    process: "claude",
    name: null,
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-deck`,
    agents: ["claude"],
    agentBusy: true,
    unread: false,
    attention: attention("working", { workingCount: 1 }),
    panes: [pane(101, "claude", "none", "working", minutesAgo(3), true)],
  },
  {
    key: 5,
    process: "codex",
    name: "architecture review",
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-deck`,
    agents: ["codex"],
    agentBusy: false,
    unread: false,
    attention: attention("completed", { actionableCount: 1 }),
    // `completed` renders as `asked` since the owner's 2026-08-16 merge: a
    // finished run nobody checked wears the same yellow as a question.
    panes: [pane(102, "codex", "completed", "idle", minutesAgo(8), true)],
  },
  {
    key: 6,
    process: "opencode",
    name: "test sweep",
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-deck`,
    agents: ["opencode", "codex", "gemini", "claude"],
    agentBusy: true,
    unread: false,
    attention: attention("working", { workingCount: 1 }),
    // Four agent panes: the row that renders the pane TREE (DL-27.13), with
    // every quiet leaf state on show — one checked run (done), one that never
    // ran (idle).
    panes: [
      pane(103, "opencode", "none", "working", SEEDED_AT - 30_000, true),
      pane(104, "codex", "none", "idle", minutesAgo(18), true),
      pane(105, "gemini", "none", "idle", minutesAgo(26)),
      pane(106, "claude", "none", "idle", minutesAgo(44), true),
    ],
  },
  {
    key: 2,
    process: "codex",
    name: "review",
    dotColor: "magenta",
    workspacePath: `${HOME}/spacevibe-api`,
    agents: ["codex"],
    agentBusy: true,
    unread: true,
    attention: attention("requested", { actionableCount: 1 }),
    panes: [pane(107, "codex", "requested", "idle", minutesAgo(4))],
  },
  {
    key: 3,
    process: "agy",
    name: null,
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-hub`,
    agents: ["agy"],
    agentBusy: true,
    unread: false,
    attention: attention("error", { actionableCount: 2 }),
    panes: [pane(108, "agy", "error", "idle", minutesAgo(12))],
  },
  {
    key: 7,
    process: "claude",
    name: null,
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-api`,
    agents: ["claude", "agy"],
    agentBusy: false,
    unread: false,
    attention: attention("requested", { actionableCount: 1 }),
    // Unnamed multi-agent: the parent row prints NO label (DL-27.13) — the
    // tree is the identity. This tab keeps that case visible in the gallery.
    panes: [
      pane(110, "claude", "requested", "idle", minutesAgo(1), true),
      pane(111, "agy", "none", "idle", minutesAgo(35)),
    ],
  },
  {
    key: 4,
    process: "zsh",
    name: null,
    dotColor: "green",
    workspacePath: `${HOME}/scratch`,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: attention("idle"),
    // A shell pane is part of the tab but never a rail row (spec §9): this tab
    // is what keeps the rail's `shell` identity and empty age visible.
    panes: [pane(109, null, "none", "unknown", 0)],
  },
];

/**
 * The newest turn of each seeded agent pane, keyed by pane id — the gallery's
 * stand-in for `session_tail` (DL-27.15), which reads real session logs no
 * browser harness has.
 *
 * Deliberately uneven: panes 105/111 are LEFT OUT so the rail shows what a
 * pane that has said nothing falls back to (its agent's name), and the
 * sentences that are here run long enough to be trimmed at rail width — the
 * one-line row (2026-08-17) shares its line with the age and the state mark,
 * so a specimen of short strings would prove nothing about the trim.
 */
export const SEED_PANE_TAILS: ReadonlyMap<number, string> = new Map([
  [101, "Reading the rail model to see where the turn line is built"],
  [102, "Done — the three sections you asked for are in the spec now"],
  [103, "Running the suite; 812 of 2619 files so far"],
  [104, "Rewrote the fixture so both hosts read the same journal"],
  [106, "Waiting on you: overwrite the existing worktree?"],
  [107, "Permission needed: prisma migrate dev"],
  [108, "Cannot reach the daemon — the socket at /tmp/agy.sock is gone"],
  [110, "Which branch should the release cut come from?"],
]);

export const SEED_STATUS: StatusInfo = {
  branch: "main",
  cwd: `${HOME}/spacevibe-deck`,
  agent: "claude",
  paneCount: 1,
  home: HOME,
};

/** Every kind the attention mark can render, in the rail's own severity order. */
export const SEED_ATTENTION: readonly AgentAttentionSummary[] = [
  attention("error", { actionableCount: 2 }),
  attention("warning", { actionableCount: 1 }),
  attention("requested", { actionableCount: 1 }),
  attention("completed", { actionableCount: 3 }),
  attention("working", { workingCount: 2 }),
  attention("unread", { unreadCount: 4 }),
  attention("idle"),
];

const SPLIT_LAYOUT: SerializedNode = {
  type: "split",
  direction: "row",
  ratio: 0.62,
  first: { type: "leaf" },
  second: {
    type: "split",
    direction: "column",
    ratio: 0.5,
    first: { type: "leaf" },
    second: { type: "leaf" },
  },
};

export const SEED_PRESETS: readonly Preset[] = [
  { id: "single", name: "Single", layout: { type: "leaf" } },
  { id: "agent-plus-shell", name: "Agent + shell", layout: SPLIT_LAYOUT },
];

export const SEED_LAYOUT = SPLIT_LAYOUT;

/* ── workbench fixture ───────────────────────────────────────────── */

/**
 * The single fixture every workbench composition renders.
 *
 * One object, not one per candidate: the comparison in
 * docs/specs/2026-08-12-agent-workbench-gallery-design.md is a comparison of
 * layouts, so the moment two candidates differ in their content the review
 * stops being about composition. `readonly` all the way down is what enforces
 * that — a candidate cannot quietly drop a workspace to make its rail fit.
 *
 * Nothing here describes an approved product surface. Paths, branches, agent
 * names and terminal output are invented; surfaces that Deck has not built are
 * flagged `future` so the markup can say so out loud rather than implying the
 * feature exists (spec §4).
 */

export interface WorkbenchProject {
  readonly name: string;
  readonly path: string;
}

export interface WorkbenchWorkspace {
  readonly id: string;
  readonly name: string;
  /** The CLI running in it — the workspace's identity, not a process id. */
  readonly agent: string;
  readonly branch: string;
  readonly attention: AgentAttentionSummary;
  readonly selected: boolean;
}

export interface WorkbenchSurface {
  readonly id: string;
  readonly label: string;
  /** No approved implementation: rendered as a non-interactive placeholder. */
  readonly future: boolean;
  readonly selected: boolean;
}

export interface WorkbenchPane {
  readonly id: string;
  /** Never painted — the pane shows its output, not a header. Names the region. */
  readonly title: string;
  readonly lines: readonly string[];
  /** The pane holding keyboard ownership — the stage's one loud state. */
  readonly focused: boolean;
}

export interface WorkbenchEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  /** Nesting level; the dock draws hierarchy with indent, not with icons. */
  readonly depth: number;
  readonly change: "none" | "modified" | "added";
  readonly selected: boolean;
}

export interface WorkbenchExplorer {
  readonly root: string;
  readonly entries: readonly WorkbenchEntry[];
}

export interface WorkbenchFixture {
  readonly project: WorkbenchProject;
  readonly workspaces: readonly WorkbenchWorkspace[];
  readonly surfaces: readonly WorkbenchSurface[];
  readonly panes: readonly WorkbenchPane[];
  readonly explorer: WorkbenchExplorer;
  readonly status: StatusInfo;
}

/**
 * Three panes in the proportions `SEED_LAYOUT` already describes — one wide
 * leaf beside a stacked pair — so the stage and the preset thumbnail further
 * down the page are showing the same split, not two unrelated guesses.
 */
const WORKBENCH_PANES: readonly WorkbenchPane[] = [
  {
    id: "pane-agent",
    title: "claude",
    lines: [
      "❯ claude",
      "reading src/terminal/pane.ts",
      "3 files changed, 128 insertions",
      "waiting for review",
    ],
    focused: true,
  },
  {
    id: "pane-review",
    title: "codex",
    lines: ["❯ codex review", "42 tests, 42 passed in 3.1s"],
    focused: false,
  },
  {
    id: "pane-shell",
    title: "zsh",
    lines: ["❯ git status --short", " M src/ui/app.tsx"],
    focused: false,
  },
];

const WORKBENCH_ENTRIES: readonly WorkbenchEntry[] = [
  {
    id: "src",
    name: "src",
    kind: "folder",
    depth: 0,
    change: "none",
    selected: false,
  },
  {
    id: "src/terminal",
    name: "terminal",
    kind: "folder",
    depth: 1,
    change: "none",
    selected: false,
  },
  {
    id: "src/terminal/pane.ts",
    name: "pane.ts",
    kind: "file",
    depth: 2,
    change: "modified",
    selected: false,
  },
  {
    id: "src/terminal/tabs-store.ts",
    name: "tabs-store.ts",
    kind: "file",
    depth: 2,
    change: "none",
    selected: false,
  },
  {
    id: "src/ui",
    name: "ui",
    kind: "folder",
    depth: 1,
    change: "none",
    selected: false,
  },
  {
    id: "src/ui/app.tsx",
    name: "app.tsx",
    kind: "file",
    depth: 2,
    change: "modified",
    selected: true,
  },
  {
    id: "src/ui/status-bar.tsx",
    name: "status-bar.tsx",
    kind: "file",
    depth: 2,
    change: "none",
    selected: false,
  },
  {
    id: "src/ui/workbench-dock.tsx",
    name: "workbench-dock.tsx",
    kind: "file",
    depth: 2,
    change: "added",
    selected: false,
  },
  {
    id: "src-tauri",
    name: "src-tauri",
    kind: "folder",
    depth: 0,
    change: "none",
    selected: false,
  },
  {
    id: "docs",
    name: "docs",
    kind: "folder",
    depth: 0,
    change: "none",
    selected: false,
  },
  {
    id: "package.json",
    name: "package.json",
    kind: "file",
    depth: 0,
    change: "none",
    selected: false,
  },
];

export const SEED_WORKBENCH: WorkbenchFixture = {
  project: { name: "spacevibe", path: `${HOME}/spacevibe-workspace` },
  workspaces: [
    {
      id: "deck",
      name: "deck",
      agent: "claude",
      branch: "main",
      attention: attention("working", { workingCount: 1 }),
      selected: true,
    },
    {
      id: "api",
      name: "api",
      agent: "codex",
      branch: "feat/vote-cutover",
      attention: attention("requested", { actionableCount: 1 }),
      selected: false,
    },
    {
      id: "hub",
      name: "hub",
      agent: "agy",
      branch: "chore/drop-live",
      attention: attention("error", { actionableCount: 2 }),
      selected: false,
    },
    {
      id: "scratch",
      name: "scratch",
      agent: "zsh",
      branch: "main",
      attention: attention("idle"),
      selected: false,
    },
  ],
  surfaces: [
    { id: "terminal", label: "terminal", future: false, selected: true },
    { id: "editor", label: "editor", future: true, selected: false },
    { id: "browser", label: "browser", future: true, selected: false },
  ],
  panes: WORKBENCH_PANES,
  explorer: {
    root: "spacevibe-deck",
    entries: WORKBENCH_ENTRIES,
  },
  status: SEED_STATUS,
};
