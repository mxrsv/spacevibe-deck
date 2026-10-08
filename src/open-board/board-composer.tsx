import {
  CaretDown,
  ClockCounterClockwise,
  FolderOpen,
  FolderPlus,
  Gear,
  GitBranch,
  X,
} from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { hasPrimaryModifier } from "../lib/platform";
import { tildify } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import { formatRelativeTime, type RecentWorkspace } from "../lib/workspace-recents";
import { GithubStarButton } from "../ui/controls/github-star-button";
import { BOARD_ICON, DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { LauncherFields, type LauncherFieldsProps } from "../launcher/launcher-fields";
import { BoardAgentLauncher } from "./board-agent-launcher";
import { TASK_PROMPT_STAGING_ENABLED } from "../terminal/task-prompt-send";

/** DL-32.1: workspace selection, shared agent cards, then recent workspaces.
 * The staged-prompt feature retains its composer when explicitly enabled.
 * Selecting a workspace never starts a process.
 */

export interface BoardComposerProps extends Omit<
  LauncherFieldsProps,
  "idPrefix" | "compact" | "onOpenFullComposer" | "recents"
> {
  readonly homeDir: string;
  /** Electron-only; omitted, never shown inert (DL-19.7). */
  readonly canCreateWorktree: boolean;
  onCreateWorktree(): void;
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
  onSelectWorkspace(path: string): void | Promise<void>;
  onRunAgent(agentId: string): void;
  /** The host can resolve a dropped folder's path; false hides the drop hint. */
  readonly canDropFolder?: boolean;
  readonly draggingFolder?: boolean;
  onBrowseSessions(): void;
  onRemove(paths: readonly string[]): void;
  /** The previous launch's session; null or absent offers nothing. */
  readonly lastSession?: LastSessionOffer | null;
  onReopenLastSession?(): void;
  onDismissLastSession?(): void;
}

/** What the last-session line prints — `LastSession` without its records. */
export interface LastSessionOffer {
  readonly tabCount: number;
  readonly workspaces: readonly string[];
}

/** Workspace names printed before the rest fold into `+N`. */
const LAST_SESSION_NAMES = 3;

function lastSessionMeta(offer: LastSessionOffer): string {
  const tabs = offer.tabCount === 1 ? "1 tab" : `${offer.tabCount} tabs`;
  const shown = offer.workspaces.slice(0, LAST_SESSION_NAMES);
  const rest = offer.workspaces.length - shown.length;
  const names = rest > 0 ? [...shown, `+${rest}`] : shown;
  return names.length === 0 ? tabs : `${tabs} · ${names.join(", ")}`;
}

export function BoardComposer(props: BoardComposerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const missingExpanded = useSignal(false);
  const busy = props.pending !== null;
  const staging = props.promptStaging ?? TASK_PROMPT_STAGING_ENABLED;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const menu = moreRef.current;
      if (menu !== null && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  useEffect(() => {
    if (busy && moreRef.current !== null) moreRef.current.open = false;
  }, [busy]);

  function moreAction(action: () => void): void {
    if (busy) return;
    if (moreRef.current !== null) moreRef.current.open = false;
    action();
  }

  function focusPrompt(): void {
    // The row's whole job is to answer the Workspace field and hand the user
    // back to what they were writing. Under `TASK_PROMPT_STAGING_ENABLED` false
    // there is nothing being written, so this is a deliberate no-op rather than
    // a second focus target invented for a composer with no prompt.
    queueMicrotask(() => {
      rootRef.current?.querySelector("textarea")?.focus();
    });
  }

  function selectWorkspace(path: string): void {
    void props.onSelectWorkspace(path);
    focusPrompt();
  }

  /** The staged composer owns ⌘Enter; agent cards keep native button keys. */
  function handleKeyDown(event: KeyboardEvent): void {
    if (!staging || event.key !== "Enter" || !hasPrimaryModifier(event)) return;
    if (props.problem !== null || busy) return;
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
    <main
      class={`nt-board ${!staging ? "nt-board--agents" : ""} ${props.draggingFolder ? "nt-board--folder-over" : ""}`}
      aria-label="Start a task"
      aria-busy={busy}
    >
      <div class="nt-board__content" ref={rootRef} onKeyDown={handleKeyDown}>
        {/* Launch reopens nothing on its own (2026-09-27); the previous
            session waits here instead, above the composer and quieter than
            it (DL-32.1), until it is reopened, dismissed or anything else
            opens. */}
        {props.lastSession ? (
          <div class="nt-last-session" role="group" aria-label="Last session">
            <DeckIcon icon={ClockCounterClockwise} size={ROW_ICON} />
            <span class="nt-last-session__text">
              <span class="nt-last-session__title">Last session</span>
              <span class="nt-last-session__meta">{lastSessionMeta(props.lastSession)}</span>
            </span>
            <button
              type="button"
              class="nt-secondary-action nt-last-session__reopen"
              disabled={busy}
              onClick={props.onReopenLastSession}
            >
              Reopen
            </button>
            <button
              type="button"
              class="nt-icon-action"
              aria-label="Dismiss last session"
              title="Dismiss"
              onClick={props.onDismissLastSession}
            >
              <DeckIcon icon={X} size={ROW_ICON} />
            </button>
          </div>
        ) : null}

        <header class="nt-board__head">
          <span>New task</span>
          <h2>Start something new</h2>
          {/* Says what actually happens, which is why it moves with
              `TASK_PROMPT_STAGING_ENABLED`. With staging on, `TASK_PROMPT_AUTOSEND`
              is false — the launch TYPES the task into the agent and stops, so the
              Enter is the user's. With it off there is no prompt to describe, and
              promising one over a composer that has no textarea is the one thing
              this line must never do. `launchNotice` carries the staged sentence
              too, but only onto a board that is already being dismissed; said here
              it is on screen before the button is ever pressed. */}
          <p>
            {staging
              ? "Describe the outcome. Deck opens the agent and types your task — press Enter there to send it."
              : "Choose a folder, then run an agent. Your work starts there."}
          </p>
        </header>

        {props.draggingFolder ? (
          <div class="nt-board__drop-hint" role="status">
            Drop a folder to use as your workspace
          </div>
        ) : null}
        {staging ? (
          <LauncherFields {...props} recents={props.alive} idPrefix="board" compact={false} />
        ) : (
          <BoardAgentLauncher {...props} />
        )}

        {staging ? (
          <div class="nt-board__shortcuts" role="group" aria-label="Workspace actions">
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
        ) : (
          <details
            class="nt-board__more"
            ref={moreRef}
            onKeyDownCapture={(event) => {
              if (event.key !== "Escape" || !moreRef.current?.open) return;
              event.preventDefault();
              event.stopPropagation();
              moreRef.current.open = false;
              moreRef.current.querySelector("summary")?.focus();
            }}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && !event.currentTarget.contains(next)) {
                event.currentTarget.open = false;
              }
            }}
          >
            <summary
              aria-disabled={busy}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              More… <DeckIcon icon={CaretDown} size={ROW_ICON} />
            </summary>
            <div class="nt-board__more-actions" role="group" aria-label="More workspace actions">
              {props.canCreateWorkspace ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => moreAction(props.onCreateWorkspace)}
                >
                  <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Create workspace…
                </button>
              ) : null}
              {props.canCreateWorktree ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => moreAction(props.onCreateWorktree)}
                >
                  <DeckIcon icon={GitBranch} size={ROW_ICON} /> Create worktree…
                </button>
              ) : null}
              {props.canBrowseSessions ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => moreAction(props.onBrowseSessions)}
                >
                  <DeckIcon icon={ClockCounterClockwise} size={ROW_ICON} /> Resume a session…
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => moreAction(props.onManageAgents)}
              >
                <DeckIcon icon={Gear} size={ROW_ICON} /> Manage agents
              </button>
            </div>
          </details>
        )}

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
