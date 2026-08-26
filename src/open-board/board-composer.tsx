import { ClockCounterClockwise, FolderOpen, FolderPlus, GitBranch, X } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { hasPrimaryModifier } from "../lib/platform";
import { tildify } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import { formatRelativeTime, type RecentWorkspace } from "../lib/workspace-recents";
import { GithubStarButton } from "../ui/controls/github-star-button";
import { BOARD_ICON, DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
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
 *
 * It replaces `OpenBoardHome`, so it carries that view's other duties rather
 * than dropping them: the session-history entry, the GitHub star ask, removing
 * a recents row, and the collapsed Missing workspaces group. The design
 * changed how a row BEHAVES; it did not ask for any of those to go. The row
 * markup keeps `OpenBoardHome`'s `.row` classes so the existing stylesheet
 * still dresses it.
 */

export interface BoardComposerProps extends Omit<
  LauncherFieldsProps,
  "idPrefix" | "compact" | "onOpenFullComposer" | "recents"
> {
  readonly homeDir: string;
  /** Folders that still exist, newest first. */
  readonly alive: readonly RecentWorkspace[];
  /** Folders `dirs_exist` could not find — collapsed behind a count. */
  readonly missingGroup: readonly RecentWorkspace[];
  /** Workspace tags on live tabs; a match means a session already runs there. */
  readonly openWorkspacePaths: ReadonlySet<string>;
  /** Electron-only session history; false omits the entry (DL-19.7). */
  readonly canBrowseSessions: boolean;
  /** The ⌘O / Ctrl+Shift+O label the folder shortcut prints. */
  readonly openFolderShortcut: string;
  /** A one-line description of the combo a row was last opened with. */
  describeCombo?: (recent: RecentWorkspace) => string;
  /** Fills the Workspace field. NEVER launches. */
  onSelectWorkspace(path: string): void;
  onBrowseSessions(): void;
  onRemove(paths: readonly string[]): void;
}

export function BoardComposer(props: BoardComposerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const missingExpanded = useSignal(false);
  const busy = props.pending !== null;

  function focusPrompt(): void {
    // The row's whole job is to answer the Workspace field and hand the user
    // back to what they were writing.
    queueMicrotask(() => {
      rootRef.current?.querySelector("textarea")?.focus();
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
    if (props.problem !== null || busy) {
      return;
    }
    props.onStartTask();
    event.preventDefault();
    event.stopPropagation();
  }

  /** One recent: sibling buttons, never a button nested inside a button. */
  function row(recent: RecentWorkspace, gone: boolean) {
    const name = workspaceLabel(recent.path);
    const combo = props.describeCombo?.(recent) ?? "";
    const selected = recent.path === props.draft.workspacePath;
    const alreadyOpen = props.openWorkspacePaths.has(recent.path);
    return (
      <li
        key={recent.path}
        class={`row ${gone ? "is-missing" : ""} ${selected ? "is-selected" : ""}`}
      >
        <button
          type="button"
          class="row__open"
          disabled={busy}
          aria-pressed={selected}
          aria-label={`Use workspace ${name}`}
          onClick={() => selectWorkspace(recent.path)}
        >
          <DeckIcon icon={FolderOpen} size={BOARD_ICON} class="row__ico" />
          <span class="row__body">
            <span class="row__headline">
              <span class="row__name">{name}</span>
              {alreadyOpen ? <span class="row__state">Open</span> : null}
            </span>
            <span class="row__meta">
              <span class="row__path">
                {props.homeDir === "" ? recent.path : tildify(recent.path, props.homeDir)}
              </span>
              {combo === "" ? null : <span class="row__combo">{combo}</span>}
              <span class="row__time">{formatRelativeTime(recent.lastOpenedAt, Date.now())}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          class="row__x"
          aria-label={`Remove ${name} from recents`}
          onClick={() => props.onRemove([recent.path])}
        >
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </li>
    );
  }

  const hasRecents = props.alive.length > 0 || props.missingGroup.length > 0;

  return (
    <main class="nt-board" aria-label="Start a task" aria-busy={busy}>
      <div class="nt-board__content" ref={rootRef} onKeyDown={handleKeyDown}>
        <header class="nt-board__head">
          <span>New task</span>
          <h2>Start something new</h2>
          {/* Says what actually happens. `TASK_PROMPT_AUTOSEND` is false — the
              launch TYPES the task into the agent and stops, so the Enter is
              the user's. `launchNotice` carries that sentence too, but only
              onto a board that is already being dismissed; said here it is on
              screen before the button is ever pressed. */}
          <p>
            Describe the outcome. Deck opens the agent and types your task — press Enter there to
            send it.
          </p>
        </header>

        <LauncherFields {...props} recents={props.alive} idPrefix="board" compact={false} />

        <div class="nt-board__shortcuts">
          <button type="button" disabled={busy} onClick={props.onPickFolder}>
            <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Open folder…
            <kbd>{props.openFolderShortcut}</kbd>
          </button>
          {props.canCreateWorkspace ? (
            <button type="button" disabled={busy} onClick={props.onCreateWorkspace}>
              <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Create workspace…
            </button>
          ) : null}
          {props.canCreateWorktree ? (
            <button type="button" disabled={busy} onClick={props.onCreateWorktree}>
              <DeckIcon icon={GitBranch} size={ROW_ICON} /> Create worktree…
            </button>
          ) : null}
          {props.canBrowseSessions ? (
            <button type="button" disabled={busy} onClick={props.onBrowseSessions}>
              <DeckIcon icon={ClockCounterClockwise} size={ROW_ICON} /> Resume a session…
            </button>
          ) : null}
        </div>

        {hasRecents ? (
          <div class="board-home__recents">
            <div class="board-home__recents-head">Recent workspaces</div>
            <ul class="board-home__list" aria-label="Recent workspaces">
              {props.alive.map((recent) => row(recent, false))}
              {props.missingGroup.length > 0 ? (
                <li class="gsep">
                  <button
                    type="button"
                    class="board-home__missing-toggle"
                    aria-expanded={missingExpanded.value}
                    onClick={() => {
                      missingExpanded.value = !missingExpanded.value;
                    }}
                  >
                    Missing workspaces ({props.missingGroup.length})
                  </button>
                  <button
                    type="button"
                    class="gsep__remove"
                    onClick={() => props.onRemove(props.missingGroup.map((entry) => entry.path))}
                  >
                    Remove {props.missingGroup.length}
                  </button>
                </li>
              ) : null}
              {missingExpanded.value ? props.missingGroup.map((recent) => row(recent, true)) : null}
            </ul>
          </div>
        ) : null}

        {/* The one thing Deck ever asks for — kept from `OpenBoardHome`, and
            still on its own row rather than joining the actions: starting a
            task is the work, this is not. */}
        <GithubStarButton variant="board" disabled={busy} />
      </div>
    </main>
  );
}
