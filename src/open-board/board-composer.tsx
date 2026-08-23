import { Folder, FolderPlus, GitBranch } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { hasPrimaryModifier } from "../lib/platform";
import { workspaceLabel } from "../lib/workspace-label";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { LauncherFields, type LauncherFieldsProps } from "../launcher/launcher-fields";

/**
 * The Open Board's focal artifact (design §4.1): a generous prompt composer,
 * one context toolbar, then Recent Workspaces as a quieter second rhythm.
 *
 * Two rules this component exists to hold:
 *
 * - **The prompt is always visible here.** Collapsing it is Quick Launch's
 *   affordance alone, so `compact` is hard-wired false rather than passed.
 * - **A recents row SELECTS.** It fills the Workspace field and returns focus
 *   to the composer; it does not launch. That reverses the 2026-08-16
 *   one-click-opens contract deliberately — a workspace choice carrying the
 *   side effect of starting a process is the thing this design set out to fix.
 */

export interface BoardComposerProps extends Omit<
  LauncherFieldsProps,
  "idPrefix" | "compact" | "onOpenFullComposer"
> {
  /** Live folders, newest first — the rows under the composer. */
  readonly recents: readonly RecentWorkspace[];
  /** A one-line description of the combo a row was last opened with. */
  describeCombo?: (recent: RecentWorkspace) => string;
  /** Fills the Workspace field. NEVER launches. */
  onSelectWorkspace(path: string): void;
}

export function BoardComposer(props: BoardComposerProps) {
  const promptRef = useRef<HTMLDivElement>(null);

  function focusPrompt(): void {
    // The row's whole job is to answer the Workspace field and hand the user
    // back to what they were writing.
    queueMicrotask(() => {
      promptRef.current?.querySelector("textarea")?.focus();
    });
  }

  function selectWorkspace(path: string): void {
    props.onSelectWorkspace(path);
    focusPrompt();
  }

  /**
   * ⌘Enter starts a task. Composer-local by design: it fires only while focus
   * is inside this subtree, so it needs no registry action, no keymap entry
   * and no menu regeneration — and it cannot reach a terminal.
   */
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !hasPrimaryModifier(event)) {
      return;
    }
    if (props.problem !== null || props.pending !== null) {
      return;
    }
    props.onStartTask();
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <main class="nt-board" aria-label="Start a task">
      <div class="nt-board__content" ref={promptRef} onKeyDown={handleKeyDown}>
        <header class="nt-board__head">
          <span>New task</span>
          <h2>Start something new</h2>
          <p>Describe the outcome. Deck opens the agent in the right workspace.</p>
        </header>

        <LauncherFields {...props} idPrefix="board" compact={false} />

        <div class="nt-board__shortcuts">
          <button type="button" onClick={props.onPickFolder}>
            <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Open folder…
          </button>
          {props.canCreateWorkspace ? (
            <button type="button" onClick={props.onCreateWorkspace}>
              <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Create workspace…
            </button>
          ) : null}
          {props.canCreateWorktree ? (
            <button type="button" onClick={props.onCreateWorktree}>
              <DeckIcon icon={GitBranch} size={ROW_ICON} /> Create worktree…
            </button>
          ) : null}
        </div>

        {props.recents.length > 0 ? (
          <section class="nt-recents">
            <div class="nt-recents__head">
              <span>Recent workspaces</span>
            </div>
            <div class="nt-recents__list">
              {props.recents.map((recent) => (
                <button
                  type="button"
                  class={`nt-recent ${recent.path === props.draft.workspacePath ? "is-selected" : ""}`}
                  key={recent.path}
                  aria-pressed={recent.path === props.draft.workspacePath}
                  onClick={() => selectWorkspace(recent.path)}
                >
                  <span class="nt-recent__mark">
                    <DeckIcon icon={Folder} size={ROW_ICON} />
                  </span>
                  <span class="nt-recent__copy">
                    <strong>{workspaceLabel(recent.path)}</strong>
                    <small>{props.describeCombo?.(recent) ?? recent.path}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
