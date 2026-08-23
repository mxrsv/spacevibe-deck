import type { Settings } from "../settings/settings-schema";
import { UNSEQUENCED } from "../lib/open-sequence";

/**
 * Non-terminal surfaces sharing the tab strip.
 *
 * TabManager knows only that they EXIST and can be activated — never what they
 * hold. That is the file-explorer spec's §2.3 seam stated as a type:
 * `TabManager` gains no knowledge of files and the file store gains no
 * knowledge of PTYs, and this interface is the entire vocabulary between them.
 *
 * `FileSurfaceController` (`src/files/file-surface-controller.ts`) is the
 * one production implementation, wired in as `TabManagerDeps.surfaces` by
 * `src/ui/app.tsx` (file-explorer plan Task 5) — every window now runs on it
 * instead of `INERT_SURFACES` below. The seam was built and proven against a
 * fake before that wiring landed because the invariants it encodes — "last
 * surface, not last tab", a combined cycle index space, `movePane`'s
 * refusal — are the ones that are expensive to retrofit and cheap to keep
 * proven; `tab-manager.file-surfaces.test.ts` still exercises both the fake AND the real
 * controller for exactly that reason.
 *
 * Every method has a no-op default (`INERT_SURFACES`), so a caller that passes
 * nothing (still true of every test in this file that omits `deps.surfaces`)
 * gets exactly the behaviour that shipped before the seam existed.
 */
/**
 * The Edit-menu commands a surface can claim.
 *
 * Cut/copy/paste are deliberately absent: Chromium dispatches a real DOM
 * `cut`/`copy`/`paste` event for those, which whatever holds the caret can
 * already answer. These three are document-level Chromium commands with no
 * DOM event at all, so a surface that does not live in the document's own
 * selection model (Monaco with `editContext` on) never hears about them.
 */
export type SurfaceEditCommand = "select-all" | "undo" | "redo";

export interface SurfaceStrip {
  /** Surfaces in the strip right now — the segment after the terminal tabs. */
  count(): number;
  /** Surfaces anywhere in this window, including ones not in the strip. The
   * "last surface, not last tab" rule asks this one. */
  total(): number;
  /** Index within the strip's segment, or -1 when a terminal tab is active. */
  activeIndex(): number;
  /**
   * When the surface at `index` was opened, on the window's shared clock
   * (`lib/open-sequence.ts`).
   *
   * The entire vocabulary the merged strip needs: TabManager orders its tabs
   * against the surfaces without learning what a surface IS, which is the
   * §2.3 seam restated for ordering. Optional so an implementation written
   * before 2026-08-16 (every `SurfaceStrip` fake in the suite) keeps
   * compiling — a missing key reads as `UNSEQUENCED` and reproduces the old
   * terminals-then-surfaces strip exactly.
   */
  orderKey?(index: number): number;
  /**
   * Run one Edit-menu command against the active surface, returning true when
   * it handled it. False (and a missing implementation) means "not mine" —
   * `runEditCommand` in tab-manager.ts then falls back to the browser's own
   * editing command, which is what the native Cocoa role used to do.
   *
   * Still the §2.3 seam: TabManager learns that a surface may own the caret,
   * never that the surface is a text editor. Optional for the same reason
   * `orderKey` is — every `SurfaceStrip` fake written before this keeps
   * compiling and keeps the pre-seam behaviour.
   */
  runEditCommand?(command: SurfaceEditCommand): boolean;
  /**
   * Whether the ACTIVE surface offers a second view of the same thing right
   * now — today, a markdown document that can be shown rendered or as source.
   *
   * Read by `isActionPerformable` before `toggle-markdown-view` consumes its
   * keystroke, so the chord passes through untouched anywhere else. Still the
   * §2.3 seam: TabManager learns that a surface may have two views, never that
   * one of them is a parsed document. Optional for the reason `orderKey` and
   * `runEditCommand` are — every `SurfaceStrip` fake written before this keeps
   * compiling with the pre-seam behaviour (no second view anywhere).
   */
  canToggleView?(): boolean;
  /** Flip the active surface's view. A no-op when it has only one. */
  toggleView?(): void;
  /** Activate the surface at `index` within the segment. */
  activate(index: number): void;
  /** A terminal tab is taking the stage. */
  deactivate(): void;
  /** Give the active surface keyboard focus. */
  focus(): void;
  /** Close the active surface, running its own guard first. */
  close(): Promise<void>;
  /** Save the active surface; a no-op when it has nothing to save. */
  save(): Promise<void>;
  applySettings(next: Settings): void;
}

/** Terminals only: no surfaces, nothing to activate. Today's every window. */
export const INERT_SURFACES: SurfaceStrip = {
  count: () => 0,
  total: () => 0,
  activeIndex: () => -1,
  orderKey: () => UNSEQUENCED,
  runEditCommand: () => false,
  canToggleView: () => false,
  toggleView: () => {},
  activate: () => {},
  deactivate: () => {},
  focus: () => {},
  close: () => Promise.resolve(),
  save: () => Promise.resolve(),
  applySettings: () => {},
};
