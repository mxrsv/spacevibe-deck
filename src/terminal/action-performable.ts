/**
 * Whether a matched binding may CONSUME its keystroke.
 *
 * `handleShortcut` (tab-manager.ts) asks this before `preventDefault()`. A
 * false answer means the binding behaves as if it did not exist and the key
 * continues to whatever holds focus — Ghostty's `performable:` principle,
 * carried on the action rather than on the binding because Deck stores user
 * overrides per action and replaces an action's whole chord set
 * (`resolveKeymap`, src/lib/keybindings.ts), so two chords of one action
 * cannot differ in conditionality. See docs/internals/terminal.md.
 *
 * Deliberately pure: it reads a context value, never a signal, so the rules
 * are testable without mounting a tab manager.
 */
import type { ShortcutAction } from "./keymap";

/** Which kind of thing currently owns the stage. */
export type StageOwner = "terminal" | "surface" | "overlay";

export interface PerformableContext {
  readonly stageOwner: StageOwner;
  /** Whether the ACTIVE TERMINAL PANE holds a selection. */
  readonly hasSelection: boolean;
  /**
   * Whether the surface holding the stage offers a second view of the same
   * thing — `SurfaceStrip.canToggleView()`, which today means a markdown
   * document (design 2026-08-23 §4).
   *
   * Optional so every `PerformableContext` literal written before this keeps
   * compiling; absent reads as "no second view", which is the direction that
   * does not consume.
   */
  readonly surfaceCanToggleView?: boolean;
  /**
   * Whether any terminal tab is open, which is what Mission Control shows
   * (DL-35.1). With none, ⌘⇧O has nothing to zoom out of and must reach
   * whatever holds focus. Optional so every context literal written before
   * this keeps compiling; absent reads as "no tab", the direction that does
   * not consume.
   */
  readonly hasTerminalTab?: boolean;
  /**
   * Mission Control itself is up. It ranks as an overlay, so this is what
   * tells its own close branch apart from another overlay covering the stage.
   * Absent reads as closed.
   */
  readonly missionControlOpen?: boolean;
}

type Predicate = (context: PerformableContext) => boolean;

/**
 * The clipboard actions and the rendered-view toggle. Every other action
 * answers true, so this table can take the remaining pane-scoped actions later
 * as a data change rather than a rework (spec, Non-goals).
 */
const PREDICATES: ReadonlyMap<ShortcutAction, Predicate> = new Map<ShortcutAction, Predicate>([
  // Stage-conditional only: inside a terminal it keeps consuming even with no
  // selection, because nothing else wants Ctrl+Shift+C and leaking it into an
  // agent TUI has unspecified behaviour (spec D2).
  ["copy-selection", (context) => context.stageOwner === "terminal"],
  // Stage AND selection conditional: with no selection the key must reach the
  // PTY as the interrupt (spec D5).
  ["copy-or-interrupt", (context) => context.stageOwner === "terminal" && context.hasSelection],
  // Surface-conditional (design 2026-08-23 §4). ⌘⇧V over a terminal, over a
  // `.ts` file or with an overlay up reaches whatever holds focus untouched —
  // which is what lets a chord this specific exist at all without a mode.
  [
    "toggle-markdown-view",
    (context) => context.stageOwner === "surface" && context.surfaceCanToggleView === true,
  ],
  // Tab-conditional, and overlay-conditional only for OTHER overlays. Mission
  // Control ranks as an overlay while open, so `stageOwner()` answers
  // "overlay" on its own close branch — that must still consume, or the
  // toggle is one-way. Behind Settings, the Open board or a modal it cannot
  // open (`App`'s preflight, DL-35.1), so the key goes to whatever has focus.
  // Renderer-only, so no host gate: it runs wherever a terminal tab does.
  [
    "toggle-mission-control",
    (context) =>
      context.hasTerminalTab === true &&
      (context.stageOwner !== "overlay" || context.missionControlOpen === true),
  ],
]);

export function isActionPerformable(action: ShortcutAction, context: PerformableContext): boolean {
  const predicate = PREDICATES.get(action);
  return predicate === undefined ? true : predicate(context);
}
