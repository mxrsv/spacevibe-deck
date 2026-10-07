import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { settings } from "../../settings/settings-store";
import { paneTails } from "../../terminal/session-tail-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildAgentRail } from "../agent-rail-model";
import { buildAttentionList, type AttentionList } from "../attention-list-model";
import { AttentionChip } from "./attention-chip";

/**
 * The needs-you chip as the strip mounts it: the same window stores the rail
 * reads, projected through the same `buildAgentRail`, so the count and the
 * sidebar cannot disagree about which pane needs the user.
 *
 * Renderer-only (DL-27.26): nothing here asks the host for anything, so it
 * draws on both the Electron and the Tauri host. What is Electron-only is the
 * rail's richer input — repository scans, and tails for the accessible name —
 * and those degrade the way the rail does: no branch in a place, the agent's
 * name in a label.
 */

export interface AttentionStripChipProps {
  /**
   * Focus exactly this pane and acknowledge only it. `App` passes the rail's
   * own pane-exact callback, which runs the attention-focus preflight (an
   * open board or settings screen is dismissed, a draft in flight blocks)
   * before `TabManager.activateForAttention`.
   */
  onFocusPane(tabIndex: number, paneId: number): void;
}

/**
 * `buildAttentionList` over the window's live stores. Not a hook: it holds no
 * state, and reads signals inside a render, which Preact tracks on its own —
 * `useAgentBoardView`'s and `currentSpaceLayout`'s shape. `now` is read once
 * per render and injected, as `AgentRail` does; the model never calls the clock.
 */
export function currentAttentionList(): AttentionList {
  return buildAttentionList(
    buildAgentRail({
      tabs: tabViews.value,
      activeIndex: activeTabIndex.value,
      scans: repositoryScans.value,
      workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
      tails: paneTails.value,
      railOrder: settings.value.railOrder,
      now: Date.now(),
    }),
  );
}

export function AttentionStripChip({ onFocusPane }: AttentionStripChipProps) {
  return <AttentionChip list={currentAttentionList()} onFocusPane={onFocusPane} />;
}
