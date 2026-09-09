/**
 * The one `SurfaceStrip` TabManager sees: the file controller's strip with
 * the browser tab composed in as the segment's last surface.
 *
 * `TabManager` deliberately knows nothing about files OR the browser — it
 * consumes the `SurfaceStrip` seam (tab-manager.ts) and `App` decides what
 * implements it, exactly how `INERT_SURFACES` → `fileController` was swapped
 * (file-explorer plan Task 5). Composing here, renderer-side, is what keeps
 * cycling (⌘⇧[/]), ⌘W routing, "last surface, not last tab" and focus
 * working for the browser without touching any R4 seam.
 *
 * Index space: `0 .. files.count()-1` are the active workspace's file tabs,
 * `files.count()` is the browser tab while it is open, and the slot after it
 * is the Agent Board while ITS chip exists (spec §4.1). Each new kind is
 * appended rather than inserted, so no existing index moves; where a chip
 * actually PAINTS is `orderKey`'s answer, not this space's.
 *
 * Mutual exclusion is enforced on every path THROUGH this object (activate,
 * deactivate); paths that reach the file store directly (explorer clicks,
 * chip clicks) are backstopped by App's exclusion effect instead — the two
 * stores never import each other.
 */
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

/** One slot in the SurfaceStrip index space, described rather than named. */
export interface StageSlotDescriptor {
  /** SurfaceStrip index this slot addresses. */
  readonly index: number;
  readonly kind: "file" | "browser" | "agent-board";
  readonly openedAt: number;
}

export interface StageSurfaceStripDeps {
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
  const boardIndex = (): number => (agentBoardOpen.value ? files.count() + browserSlot() : -1);
  /** Take the board off the stage if it holds it; report whether it did. */
  const stepBoardBack = (): boolean => {
    if (!agentBoardSurfaceActive.value) {
      return false;
    }
    stepBoardOffStage();
    return true;
  };
  return {
    count: () => files.count() + browserSlot() + boardSlot(),
    total: () => files.total() + browserSlot() + boardSlot(),
    activeIndex: () =>
      agentBoardSurfaceActive.value
        ? boardIndex()
        : browserSurfaceActive.value
          ? files.count()
          : files.activeIndex(),
    // Same delegation as every other method: file indexes go to the file
    // strip, the browser's and the board's own slots answer from their stores.
    // The merged strip then places each chip by when it was opened, not by
    // this index space — which is why the browser can now sit BEFORE a file
    // tab even though it is still a later index here.
    orderKey: (index) =>
      index === boardIndex()
        ? agentBoardOpenedAt.value
        : browserOpen.value && index === files.count()
          ? browserOpenedAt.value
          : (files.orderKey?.(index) ?? UNSEQUENCED),
    // Straight delegation, with no browser branch: the file side answers
    // false unless its editor actually holds the caret, so a browser tab on
    // the stage falls through to the browser's own handling exactly as it did
    // when these three were native Cocoa roles.
    runEditCommand: (command) => files.runEditCommand?.(command) ?? false,
    // The board is tested FIRST because its slot is the highest index: an
    // `index === files.count()` test would claim the board's slot as the
    // browser's the moment the browser is closed and the board is open.
    activate(index) {
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
      if (browserOpen.value && index === files.count()) {
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
      const browserChanged = stepBrowserBack();
      files.activate(index);
      if (boardChanged || browserChanged) {
        onChanged();
      }
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
      if (agentBoardSurfaceActive.value || browserSurfaceActive.value) {
        return; // neither a web page nor the Board has anything Deck can save
      }
      await files.save();
    },
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
export function stageSurfaceDescriptors(
  // The file side's own two methods, structurally — not `FileSurfaceController`,
  // which would drag the file layer's type into a module TabManager consumes.
  files: Pick<SurfaceStrip, "count" | "orderKey">,
): readonly StageSlotDescriptor[] {
  const slots: StageSlotDescriptor[] = [];
  for (let index = 0; index < files.count(); index += 1) {
    slots.push({ index, kind: "file", openedAt: files.orderKey?.(index) ?? UNSEQUENCED });
  }
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
