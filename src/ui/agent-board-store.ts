import { signal } from "@preact/signals";
import { nextOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import type { BoardStatusFilter } from "./agent-board-model";

/**
 * The Agent Board's window-scoped state (spec §4.2, §11.3) — the browser
 * store's shape, deliberately NOT `boardOpen` in `chrome/events.ts`, which is
 * the Open Board's. Three signals say whether the chip exists, where it sits
 * in the strip's open order, and whether it holds the stage; the rest is
 * Board-local and resets when the chip closes (§4.4).
 */
export const agentBoardOpen = signal(false);
export const agentBoardOpenedAt = signal(UNSEQUENCED);
export const agentBoardSurfaceActive = signal(false);

export const boardSelectedPaneId = signal<number | null>(null);
export const boardStatusFilter = signal<BoardStatusFilter>("all");
export const boardProjectFilter = signal<string | null>(null);
export const boardHeldOrder = signal<readonly number[] | null>(null);

export function openAgentBoard(): void {
  if (!agentBoardOpen.value) {
    agentBoardOpen.value = true;
    agentBoardOpenedAt.value = nextOpenSequence();
  }
  agentBoardSurfaceActive.value = true;
}

export function activateAgentBoard(): void {
  if (agentBoardOpen.value) {
    agentBoardSurfaceActive.value = true;
  }
}

export function stepAgentBoardBack(): void {
  agentBoardSurfaceActive.value = false;
}

export function selectBoardCard(paneId: number | null, currentOrder: readonly number[]): void {
  boardSelectedPaneId.value = paneId;
  boardHeldOrder.value = paneId === null ? null : [...currentOrder];
}

function resetBoardLocal(): void {
  boardSelectedPaneId.value = null;
  boardStatusFilter.value = "all";
  boardProjectFilter.value = null;
  boardHeldOrder.value = null;
}

export function closeAgentBoard(): void {
  agentBoardOpen.value = false;
  agentBoardSurfaceActive.value = false;
  agentBoardOpenedAt.value = UNSEQUENCED;
  resetBoardLocal();
}

export function resetAgentBoardStore(): void {
  closeAgentBoard();
  boardSnapshotTick.value = 0;
}

/**
 * How often the panel re-reads a WORKING pane's scrollback (spec §7.3).
 *
 * 500ms is the spec's own working figure. It costs a read of an in-memory
 * xterm buffer plus a string strip — no IPC, no PTY — and the alternative is a
 * panel that goes still while the agent it is about keeps talking.
 */
export const SNAPSHOT_THROTTLE_MS = 500;

/**
 * Bumped whenever the panel's snapshot should be re-read (spec §7.3).
 *
 * A tick rather than the text itself: the buffer lives in the terminal layer
 * and `boardPanelState` already knows how to ask for it, so this only has to
 * say WHEN. Reading it there is what subscribes the render.
 *
 * It exists because the cadence `App`'s own re-renders produce is incidental in
 * BOTH directions. The panel re-read while the Board was off the stage, since
 * `stepAgentBoardBack` deliberately keeps the selection so the chord returns to
 * the same panel — and it did NOT re-read for the case the Board exists for, a
 * selected pane streaming inside the ACTIVE tab: `unread` marking is
 * background-only, so that output fires no `syncViews` and moves no signal the
 * render reads.
 */
export const boardSnapshotTick = signal(0);

export interface SnapshotRefreshDeps {
  readonly selectedPaneId: () => number | null;
  /** The selected card's state — only `working` earns the timer. */
  readonly paneState: () => string | null;
  /** Whether the Board actually holds the stage. */
  readonly onStage: () => boolean;
}

/**
 * Drive the snapshot's cadence, and return a disposer.
 *
 * Three conditions, all required, and each is a rule rather than a precaution:
 * a pane must be SELECTED (there is no snapshot otherwise), the Board must be
 * ON THE STAGE (a timer for a panel nobody can see is the idle loop DL-1.2
 * bans, and a kept selection means "selected" alone does not imply "visible"),
 * and the pane must be WORKING (a quiet pane changes on `changedAt`, which the
 * render already sees).
 */
export function installSnapshotRefresh(deps: SnapshotRefreshDeps): () => void {
  const timer = setInterval(() => {
    if (deps.selectedPaneId() === null) return;
    if (!deps.onStage()) return;
    if (deps.paneState() !== "working") return;
    boardSnapshotTick.value += 1;
  }, SNAPSHOT_THROTTLE_MS);
  return () => clearInterval(timer);
}
