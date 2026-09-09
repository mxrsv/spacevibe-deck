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
   * Whether THIS host can show the Agent Board (spec §4.2, §13).
   *
   * The Board needs `session_tail`, `git_repository` and the
   * `pty_kill_foreground` channel, none of which exist under Tauri — so the
   * chord must not be consumed there, or ⌘⇧O would die in the renderer
   * instead of reaching the terminal. Optional so every context literal
   * written before this keeps compiling; absent reads as "no Board", the
   * direction that does not consume.
   */
  readonly hostHasAgentBoard?: boolean;
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
  // Host-conditional ONLY — deliberately not stage-conditional. The Board is
  // itself a stage surface, so its own close branch runs while `stageOwner()`
  // answers "surface"; a stage test here would make the toggle one-way. What
  // the Board may do while an overlay is up is `overlayBlocksAction`'s
  // question, and it already answers it from the action's "pane" tier.
  ["toggle-agent-board", (context) => context.hostHasAgentBoard === true],
]);

export function isActionPerformable(action: ShortcutAction, context: PerformableContext): boolean {
  const predicate = PREDICATES.get(action);
  return predicate === undefined ? true : predicate(context);
}
