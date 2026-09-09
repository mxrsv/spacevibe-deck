import { useSignal } from "@preact/signals";
import type { RepositoryScan } from "../../repositories/repository-client";
import type { PaneView, TabView } from "../../terminal/tabs-store";
import { AgentBoard, type AgentBoardActions } from "../../ui/agent-board";
import {
  buildAgentBoard,
  type AgentBoardInput,
  type BoardStatusFilter,
} from "../../ui/agent-board-model";
import type { BoardPanelState } from "../../ui/agent-board-panel";
import { SEED_HOME } from "../seed-data";
import { SectionHead, Specimen } from "../specimen";

/**
 * The REAL Agent Board over a fixture (spec docs/specs/2026-09-03-agent-board-design.md,
 * DL §34). Nothing here is drawn: the cards come out of `buildAgentBoard` and the
 * markup out of `AgentBoard`, so what the owner judges by eye is what the app will
 * render once the wiring plan binds the same component to the stores.
 *
 * The fixture is chosen to put every card state on one screen — one `failed`,
 * two `asked`, three `working`, one `done`, one `idle` that never ran, and one
 * departed agent — across two projects and three checkouts, which is also
 * what gives the nav's PROJECTS group something to fold.
 */

const DECK = `${SEED_HOME}/spacevibe-deck`;
const DECK_FIX = `${SEED_HOME}/deck-worktrees/fix-rail`;
const API = `${SEED_HOME}/spacevibe-api`;
const NOW = Date.now();
const minutesAgo = (minutes: number): number => NOW - minutes * 60_000;

function repo(key: string, worktrees: readonly { path: string; branch: string }[]): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path,
      head: "0".repeat(40),
      branch: entry.branch,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  };
}

const DECK_SCAN = repo("spacevibe-deck", [
  { path: DECK, branch: "main" },
  { path: DECK_FIX, branch: "fix/rail" },
]);

const SCANS = new Map<string, RepositoryScan>([
  [DECK, DECK_SCAN],
  [DECK_FIX, DECK_SCAN],
  [API, repo("spacevibe-api", [{ path: API, branch: "main" }])],
]);

function pane(
  paneId: number,
  agent: string | null,
  attention: PaneView["attention"],
  phase: PaneView["phase"],
  changedAt: number,
  hasRun = true,
): PaneView {
  return { paneId, agent, attention, phase, hasRun, changedAt, focused: false };
}

function tab(
  key: number,
  workspacePath: string,
  panes: readonly PaneView[],
  name: string | null = null,
): TabView {
  return {
    key,
    process: panes[0]?.agent ?? "zsh",
    name,
    dotColor: null,
    workspacePath,
    agents: panes.flatMap((entry) => (entry.agent ? [entry.agent] : [])),
    agentBusy: panes.some((entry) => entry.phase === "working"),
    unread: false,
    panes,
    openedAt: key,
  };
}

const TABS: readonly TabView[] = [
  tab(1, DECK, [pane(101, "claude", "none", "working", minutesAgo(1))]),
  tab(2, DECK, [pane(102, "codex", "completed", "idle", minutesAgo(6))], "architecture review"),
  tab(
    3,
    DECK,
    [
      pane(103, "claude", "requested", "idle", minutesAgo(2)),
      pane(104, "opencode", "none", "working", minutesAgo(1)),
    ],
    "api",
  ),
  tab(4, DECK_FIX, [pane(105, "gemini", "none", "idle", minutesAgo(40))]),
  tab(5, API, [pane(106, "codex", "none", "working", minutesAgo(3))]),
  tab(6, API, [pane(107, "claude", "none", "idle", minutesAgo(15), false)]),
  tab(7, API, [pane(108, null, "completed", "idle", minutesAgo(4))]),
  tab(8, DECK_FIX, [pane(109, "codex", "error", "idle", minutesAgo(5))]),
];

const BASE: Omit<
  AgentBoardInput,
  "selectedPaneId" | "statusFilter" | "projectFilter" | "heldOrder"
> = {
  tabs: TABS,
  activeIndex: 0,
  scans: SCANS,
  workspaceHistoryPaths: [DECK, DECK_FIX, API],
  tails: new Map([
    [101, "Reading agent-rail-model.ts to find where the tab tier is projected"],
    [102, "Both approaches are viable; I recommend the pure projection"],
    [103, "Should I overwrite the existing migration or create a new one?"],
    [104, "Running the rail suite"],
    [105, "Nothing to report"],
    [106, "Adding the contract test for pty_kill_foreground"],
    [109, "Build failed: tsc exit 2"],
  ]),
  ordinals: new Map([
    [101, 1],
    [102, 2],
    [103, 3],
    [104, 4],
    [105, 5],
    [106, 6],
    [107, 7],
    [108, 8],
    [109, 9],
  ]),
  startedAt: new Map([
    [101, minutesAgo(12)],
    [102, minutesAgo(48)],
    [103, minutesAgo(9)],
    [104, minutesAgo(9)],
    [106, minutesAgo(31)],
    [108, minutesAgo(70)],
    [109, minutesAgo(18)],
  ]),
  tasks: new Map([
    [101, "Refactor the rail model so the board can reuse its projection"],
    [106, "Add the kill-foreground channel and its contract test"],
  ]),
  lastAgents: new Map([[108, "claude"]]),
  confidence: new Map([
    [101, "explicit"],
    [102, "inferred"],
    [104, "inferred"],
    [106, "inferred"],
  ]),
  home: SEED_HOME,
  now: NOW,
};

const NOOP: AgentBoardActions = {
  onSelect: () => {},
  onOpenInStage: () => {},
  onStop: () => {},
  onRestart: () => {},
  onClose: () => {},
  onReply: () => {},
  onStatusFilter: () => {},
  onProjectFilter: () => {},
  onNewAgent: () => {},
  onEscape: () => {},
};

const PANEL_CLOSED: BoardPanelState = {
  snapshot: null,
  replyEnabled: false,
  replyNotice: null,
  sending: false,
  paneExited: false,
};

/* The board fills the box it is given (`.agent-board` is `width/height: 100%`),
   so each specimen states one. Hoisted rather than inline: a fresh object per
   render is what `react-perf` warns about. */
const STAGE_TALL = { height: "640px", position: "relative" } as const;
const STAGE_SHORT = { height: "320px", position: "relative" } as const;

const SNAPSHOT = [
  "$ claude --dangerously-skip-permissions",
  "",
  "> Refactor the rail model so the board can reuse its projection",
  "",
  "⏺ Reading agent-rail-model.ts…",
  "⏺ The tab tier is projected in paneRows(); the board can join by paneId.",
  "",
  "Should I overwrite the existing migration or create a new one?",
  "❯ 1. Overwrite",
  "  2. Create a new one",
].join("\n");

/**
 * The one live specimen. Selection, both filters and the held order are local
 * signals, so a click really opens the panel and the nav really filters — the
 * gallery drives the same actions the wiring plan will.
 */
function LiveBoard() {
  // `null` since DECK-43: nothing in the app selects a card any more, so a
  // specimen that opened with one washed would be showing a state the owner
  // cannot reach. The signal and its action stay wired — `onSelect` is still
  // on the actions type, and a revert re-mounts what reads it.
  const selected = useSignal<number | null>(null);
  const status = useSignal<BoardStatusFilter>("all");
  const project = useSignal<string | null>(null);
  const held = useSignal<readonly number[] | null>(null);
  const view = buildAgentBoard({
    ...BASE,
    selectedPaneId: selected.value,
    statusFilter: status.value,
    projectFilter: project.value,
    heldOrder: held.value,
  });
  const actions: AgentBoardActions = {
    ...NOOP,
    onSelect: (card) => {
      selected.value = card?.paneId ?? null;
      held.value = card === null ? null : view.cards.map((entry) => entry.paneId);
    },
    onStatusFilter: (filter) => {
      status.value = filter;
    },
    onProjectFilter: (key) => {
      project.value = key;
    },
  };
  const panel: BoardPanelState =
    view.selected === null
      ? PANEL_CLOSED
      : {
          snapshot: SNAPSHOT,
          replyEnabled: !view.selected.departed,
          replyNotice: view.selected.state === "asked" ? "placed — confirm in the terminal" : null,
          sending: false,
          paneExited: false,
        };
  return <AgentBoard view={view} actions={actions} panel={panel} />;
}

export function AgentBoardSection() {
  const emptyView = buildAgentBoard({
    ...BASE,
    tabs: [tab(9, DECK, [pane(901, null, "none", "idle", NOW, false)])],
    ordinals: new Map(),
    selectedPaneId: null,
    statusFilter: "all",
    projectFilter: null,
    heldOrder: null,
  });
  const filteredView = buildAgentBoard({
    ...BASE,
    // Excludes tab 8's failed pane, which the fixture now carries so the
    // live specimen can show the red state: this specimen instead pins the
    // Failed row at a genuine zero count (finding #2's fix), which is what
    // "a filter that yields nothing" is supposed to demonstrate.
    tabs: TABS.filter((entry) => entry.key !== 8),
    selectedPaneId: null,
    statusFilter: "failed",
    projectFilter: null,
    heldOrder: null,
  });
  return (
    <>
      <SectionHead
        title="Agent Board"
        blurb="The real AgentBoard over a fixture: two projects, three checkouts, nine cards through buildAgentBoard. Since DECK-43 the grid is the whole Board — no filter nav, no detail panel — and a press opens that agent's pane on the stage. Spec docs/specs/2026-09-03-agent-board-design.md, DL §34."
      />
      {/* No `framed` and no `tall`: `.window` is a three-row grid, so an
          unplaced child lands on the frame row and the board is clipped to
          `--frame-h` (measured 2026-09-03: 640px of board inside a 64px
          stage). The board occupies the STAGE in the app, not the window
          shell, so the specimen hands it its own box instead. */}
      <Specimen name="board — live, nine cards" surface="bg">
        <div style={STAGE_TALL}>
          <LiveBoard />
        </div>
      </Specimen>
      <Specimen name="board — tabs but no agents (§4.4)" surface="bg">
        <div style={STAGE_SHORT}>
          <AgentBoard view={emptyView} actions={NOOP} panel={PANEL_CLOSED} />
        </div>
      </Specimen>
      <Specimen name="board — a filter that yields nothing (§4.4)" surface="bg">
        <div style={STAGE_SHORT}>
          <AgentBoard view={filteredView} actions={NOOP} panel={PANEL_CLOSED} />
        </div>
      </Specimen>
    </>
  );
}
