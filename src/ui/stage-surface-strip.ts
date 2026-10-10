/** Browser/board occupy the stage; documents remain in the Explorer beside it. */
import type { SurfaceStrip } from "../terminal/tab-manager";
import type { BrowserClient } from "../browser/browser-client";
import {
  activateBrowserSurface,
  browserOpen,
  browserOpenedAt,
  browserSurfaceActive,
  closeBrowser,
  deactivateBrowserSurface,
} from "../browser/browser-store";
import {
  activateAgentBoard,
  agentBoardOpen,
  agentBoardOpenedAt,
  agentBoardSurfaceActive,
  closeAgentBoard,
  stepAgentBoardBack as stepBoardOffStage,
} from "./agent-board-store";
import { UNSEQUENCED } from "../lib/open-sequence";
import { dismissMissionControl } from "./mission-control/mission-control-store";

/** One slot in the SurfaceStrip index space, described rather than named. */
export interface StageSlotDescriptor {
  /** SurfaceStrip index this slot addresses. */
  readonly index: number;
  readonly kind: "browser" | "agent-board";
  readonly openedAt: number;
}

export interface StageSurfaceStripDeps {
  readonly beforeActivate?: () => void;
  /** The file controller's own strip — delegated to for every file index. */
  readonly files: SurfaceStrip;
  readonly client: BrowserClient;
  /**
   * Fired after a browser transition this object caused, so TabManager
   * re-derives `tabViews`/status — the browser half of the file side's
   * `onSurfacesChanged` (app.tsx wires both to `notifySurfacesChanged`).
   */
  readonly onChanged: () => void;
}

export function composeSurfaceStrip(deps: StageSurfaceStripDeps): SurfaceStrip {
  const { files, client, onChanged } = deps;
  const browserSlot = (): number => (browserOpen.value ? 1 : 0);
  /** Hide the browser surface if it holds the stage; report whether it did. */
  const stepBrowserBack = (): boolean => {
    if (!browserSurfaceActive.value) {
      return false;
    }
    deactivateBrowserSurface(client);
    return true;
  };
  const boardSlot = (): number => (agentBoardOpen.value ? 1 : 0);
  /** Index of the board's own slot while its chip exists, else -1. */
  const boardIndex = (): number => (agentBoardOpen.value ? browserSlot() : -1);
  /** Take the board off the stage if it holds it; report whether it did. */
  const stepBoardBack = (): boolean => {
    if (!agentBoardSurfaceActive.value) {
      return false;
    }
    stepBoardOffStage();
    return true;
  };
  return {
    count: () => browserSlot() + boardSlot(),
    hasFocus: () =>
      files.activeIndex() >= 0 || browserSurfaceActive.value || agentBoardSurfaceActive.value,
    total: () => files.total() + browserSlot() + boardSlot(),
    activeIndex: () =>
      agentBoardSurfaceActive.value ? boardIndex() : browserSurfaceActive.value ? 0 : -1,
    // Only surfaces occupying the stage participate in tab navigation.
    orderKey: (index) =>
      index === boardIndex()
        ? agentBoardOpenedAt.value
        : browserOpen.value && index === 0
          ? browserOpenedAt.value
          : UNSEQUENCED,
    // Straight delegation, with no browser branch: the file side answers
    // false unless its editor actually holds the caret, so a browser tab on
    // the stage falls through to the browser's own handling exactly as it did
    // when these three were native Cocoa roles.
    runEditCommand: (command) => files.runEditCommand?.(command) ?? false,
    // The board is tested FIRST because its slot is the highest index: an
    // `index === 0` test would claim the board's slot as the
    // browser's the moment the browser is closed and the board is open.
    activate(index) {
      if (index >= 0 && index < browserSlot() + boardSlot()) deps.beforeActivate?.();
      if (index === boardIndex()) {
        if (agentBoardSurfaceActive.value) {
          return; // already on the stage
        }
        files.deactivate();
        stepBrowserBack();
        activateAgentBoard();
        onChanged();
        return;
      }
      const boardChanged = stepBoardBack();
      if (browserOpen.value && index === 0) {
        if (browserSurfaceActive.value) {
          // `boardChanged` is necessarily false here: every path through this
          // object steps the other surface back before activating one, so the
          // browser cannot hold the stage while the board does.
          return; // already on the stage
        }
        files.deactivate();
        activateBrowserSurface();
        onChanged();
        return;
      }
      // Last terminal closed: retained documents keep the window usable.
      if (browserSlot() + boardSlot() === 0) files.activate(index);
      if (boardChanged) onChanged();
    },
    deactivate() {
      const boardChanged = stepBoardBack();
      const browserChanged = stepBrowserBack();
      files.deactivate();
      if (boardChanged || browserChanged) {
        onChanged();
      }
    },
    focus() {
      if (files.activeIndex() >= 0) {
        files.focus();
        return;
      }
      if (agentBoardSurfaceActive.value) {
        // The Board takes DOM focus through its own mount effect: focusing
        // from here would fight the roving focus inside its card grid.
        return;
      }
      if (browserSurfaceActive.value) {
        // The native view owns its own focus; there is no DOM element here
        // that could meaningfully take it (the address bar stealing focus on
        // every settings change would be worse than a no-op).
        return;
      }
      files.focus();
    },
    async close() {
      if (files.activeIndex() >= 0) {
        await files.close();
        return;
      }
      if (agentBoardSurfaceActive.value) {
        // ⌘W on the Board closes the CHIP, not the panes it lists (spec
        // §4.4): its own state resets and every agent keeps running.
        closeAgentBoard();
        onChanged();
        return;
      }
      if (browserSurfaceActive.value) {
        await closeBrowser(client);
        onChanged();
        return;
      }
      await files.close();
    },
    async save() {
      if (files.activeIndex() >= 0) await files.save();
    },
    canToggleView: () => files.canToggleView?.() ?? false,
    toggleView: () => files.toggleView?.(),
    applySettings(next) {
      files.applySettings(next);
    },
  };
}

/**
 * Every open surface slot, in the SurfaceStrip index space, described by KIND.
 *
 * `TabStrip` used to read "not a file tab ⇒ the browser", which was true while
 * there were exactly two kinds and silently wrong at three. Naming the kind
 * here keeps the strip's chip rendering a lookup rather than an inference, and
 * keeps `TabManager` on the same `SurfaceStrip` seam it had before (R4) — this
 * function is the renderer's own reading of the space the composer publishes,
 * not a widening of what TabManager consumes.
 */
export function stageSurfaceDescriptors(): readonly StageSlotDescriptor[] {
  const slots: StageSlotDescriptor[] = [];
  if (browserOpen.value) {
    slots.push({ index: slots.length, kind: "browser", openedAt: browserOpenedAt.value });
  }
  if (agentBoardOpen.value) {
    slots.push({ index: slots.length, kind: "agent-board", openedAt: agentBoardOpenedAt.value });
  }
  return slots;
}

/** What a chip press needs: the file side's step-back and the browser client. */
export interface StageChipDeps {
  readonly files: Pick<SurfaceStrip, "deactivate">;
  readonly client: BrowserClient;
}

/**
 * A chip press: `kind` takes the stage and every other surface steps back.
 * Answers whether anything actually moved, so the caller notifies TabManager
 * once and only for a real transition.
 *
 * ONE function rather than a closure per chip, because the defect this closes
 * was exactly an asymmetry between two of them: `selectAgentBoardTab` cleared
 * the browser while `selectBrowserTab` never cleared the Board, so a press on
 * the browser chip left BOTH flags true. `composeSurfaceStrip` tests the board
 * first in `activeIndex()` and `close()` — so the strip highlighted the Board's
 * chip while the browser was on screen, and ⌘W closed the Board's chip while
 * the user was looking at the browser. With one body there is no second place
 * to forget.
 *
 * Chip presses are the paths that never speak this module's index space; the
 * ones that do run the same rule inside `activate()` above.
 */
export function takeStageForSurface(kind: "browser" | "agent-board", deps: StageChipDeps): boolean {
  if (kind === "browser" ? browserSurfaceActive.value : agentBoardSurfaceActive.value) {
    return false; // already on the stage
  }
  if (kind === "agent-board" && !agentBoardOpen.value) {
    // No chip exists, so this is unreachable from one — but `activateAgentBoard`
    // is a no-op on a closed board, and reporting a transition that did not
    // happen would have the caller poke TabManager over nothing.
    return false;
  }
  deps.files.deactivate();
  if (browserSurfaceActive.value) {
    deactivateBrowserSurface(deps.client);
  }
  stepBoardOffStage();
  if (kind === "browser") {
    activateBrowserSurface();
  } else {
    activateAgentBoard();
  }
  return true;
}

/**
 * `prepareStage` for a page the user asked to SEE (a dev server's Open in Deck).
 *
 * A chip press leaves Mission Control up with the native view hidden under it
 * (`overlayCoversPane`), which is right for a press that only picks a surface.
 * Opening an address is a request to look at that page, and `open` shows the
 * view host-side: left up, Mission Control would sit over a visible native
 * view that paints above it. So it is dismissed first, without a zoom, as a
 * strip or rail press does (docs/internals/mission-control.md).
 */
export function takeStageForOpenedPage(deps: StageChipDeps): void {
  dismissMissionControl();
  takeStageForSurface("browser", deps);
}
