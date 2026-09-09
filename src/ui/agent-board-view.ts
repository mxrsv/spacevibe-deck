import { paneSignal } from "./agent-rail-model";
import { getDesktopEnvironment } from "../lib/platform";
import type { PaneAgent } from "../lib/process-info";
import { workspacesData } from "../open-board/workspaces-store";
import type { RepositoryScan } from "../repositories/repository-client";
import { repositoryScans } from "../repositories/repositories-store";
import { settings } from "../settings/settings-store";
import { paneTaskPrompts } from "../terminal/board-task-prompts";
import { paneTails } from "../terminal/session-tail-store";
import { activeTabIndex, tabViews, type PaneView, type TabView } from "../terminal/tabs-store";
import {
  buildAgentBoard,
  type AgentBoardInput,
  type AgentBoardView,
  type BoardConfidence,
  type BoardStatusFilter,
} from "./agent-board-model";
import {
  boardHeldOrder,
  boardProjectFilter,
  boardSelectedPaneId,
  boardStatusFilter,
} from "./agent-board-store";

/**
 * Everything the Board's projection needs, in one bag (spec §11.9).
 *
 * A record rather than a set of signal reads, so the assembly is testable
 * without a renderer: `useAgentBoardView` reads the signals and hands them
 * here, and every rule about HOW a window fact becomes model input lives in
 * one pure function.
 *
 * `AgentRailInput.models` is deliberately NOT a member. `agent-rail.tsx`
 * declines to surface `paneModels` because that map's pane→session pairing is
 * ranked by cwd/mtime and then pinned rather than causally bound to the pane,
 * and `BoardCard` has no model field to print it in — threading it would carry
 * a distrusted fact into a card that cannot show it.
 */
export interface BoardViewSources {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly workspaceHistoryPaths: readonly string[];
  readonly tails: ReadonlyMap<number, string>;
  readonly tasks: ReadonlyMap<number, string>;
  /**
   * Kept as an input for the gallery and for tests, which build a view with no
   * `PaneView.ordinal` at all. In the app it is EMPTY: `syncViews` writes the
   * field, and `boardInputFrom` prefers the field.
   */
  readonly ordinals: ReadonlyMap<number, number>;
  readonly railOrder: readonly string[];
  readonly home?: string;
  readonly selectedPaneId: number | null;
  readonly statusFilter: BoardStatusFilter;
  readonly projectFilter: string | null;
  readonly heldOrder: readonly number[] | null;
  readonly now: number;
}

/**
 * The trust tier a card claims (spec §11.8) — the one place the trust audit's
 * `explicit | inferred` bit reaches a pixel, as the panel's `State` suffix.
 *
 * READ off the pane, never re-derived: the tracker already decides this
 * (`agent-attention.ts:37`), and `AttentionKind` —
 * `"none" | "completed" | "requested" | "warning" | "error"` — carries no such
 * distinction, so any rule written here from `attention` would be a second,
 * disagreeing answer. A pane whose view predates the field (a fixture), and a
 * pane no poll has classified yet, have no claim to make and get none.
 */
function confidenceOf(pane: PaneView): BoardConfidence | undefined {
  const confidence = paneSignal(pane).confidence;
  return confidence === "unknown" ? undefined : confidence;
}

export function boardInputFrom(sources: BoardViewSources): AgentBoardInput {
  const ordinals = new Map(sources.ordinals);
  const startedAt = new Map<number, number>();
  const lastAgents = new Map<number, PaneAgent>();
  const confidence = new Map<number, BoardConfidence>();
  for (const tab of sources.tabs) {
    for (const pane of tab.panes ?? []) {
      // The FIELD wins over the map: `syncViews` allocated it from the same
      // clock in the same pass that produced this `PaneView`, so a map read a
      // render later cannot lag a split by a frame.
      if (pane.ordinal !== undefined) ordinals.set(pane.paneId, pane.ordinal);
      if (pane.startedAt !== undefined) startedAt.set(pane.paneId, pane.startedAt);
      if (pane.lastAgent !== undefined) lastAgents.set(pane.paneId, pane.lastAgent);
      const tier = confidenceOf(pane);
      if (tier !== undefined) {
        confidence.set(pane.paneId, tier);
      }
    }
  }
  return {
    tabs: sources.tabs,
    activeIndex: sources.activeIndex,
    scans: sources.scans,
    workspaceHistoryPaths: sources.workspaceHistoryPaths,
    tails: sources.tails,
    railOrder: sources.railOrder,
    now: sources.now,
    ordinals,
    startedAt,
    lastAgents,
    confidence,
    tasks: sources.tasks,
    home: sources.home,
    selectedPaneId: sources.selectedPaneId,
    statusFilter: sources.statusFilter,
    projectFilter: sources.projectFilter,
    heldOrder: sources.heldOrder,
  };
}

/** Every pane's ordinal reaches the model on `PaneView` now; see `BoardViewSources`. */
const EMPTY_ORDINALS: ReadonlyMap<number, number> = new Map();

/**
 * The Board's view for this render.
 *
 * Named `use…` for its call site, but it is not a hook: it holds no state and
 * calls none — it is a plain read of signals inside a render, which Preact
 * tracks on its own.
 *
 * `now` is read once per render and injected, exactly as `AgentRail` does: the
 * model never calls the clock, so a test can place a card's uptime anywhere.
 */
export function useAgentBoardView(): AgentBoardView {
  return buildAgentBoard(
    boardInputFrom({
      tabs: tabViews.value,
      activeIndex: activeTabIndex.value,
      scans: repositoryScans.value,
      workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
      tails: paneTails.value,
      tasks: paneTaskPrompts.value,
      // Task 2 retired the store's map: every ordinal reaches the model on
      // `PaneView` now, and `boardInputFrom` fills `ordinals` FROM that field.
      // The empty map is the seed, not the answer — passing it straight to
      // `buildAgentBoard` without going through `boardInputFrom` would rank
      // every card at `UNSEQUENCED` (`agent-board-model.ts:255-256`).
      ordinals: EMPTY_ORDINALS,
      railOrder: settings.value.railOrder,
      // What lets a plain folder's card print `~/scratch` rather than the
      // absolute path (`tildePath`, `agent-board-model.ts:131-137`) — the
      // form the approved specimen shows. Read per render rather than once at
      // module load, because the environment is initialized asynchronously
      // from the backend and a module-level read could capture the fallback.
      // The unsupported-platform fallback is the empty string, which
      // `tildePath` already declines to match against, so no guard is needed.
      home: getDesktopEnvironment().homeDir,
      selectedPaneId: boardSelectedPaneId.value,
      statusFilter: boardStatusFilter.value,
      projectFilter: boardProjectFilter.value,
      heldOrder: boardHeldOrder.value,
      now: Date.now(),
    }),
  );
}
