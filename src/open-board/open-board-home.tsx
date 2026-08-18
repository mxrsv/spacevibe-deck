import { FolderOpen, FolderPlus, GitBranch, Robot, Terminal, X } from '@phosphor-icons/react';
import { BOARD_ICON, DeckIcon, ROW_ICON } from '../ui/controls/deck-icon';
import { folderName, formatRelativeTime } from '../lib/workspace-recents';
import type { RecentWorkspace } from '../lib/workspace-recents';
import { tildify } from '../lib/process-info';
import { logoDataUrl } from '../settings/logo-store';
import { SESSION_AGENT_LABELS, type SessionEntry } from '../lib/session-history';
import defaultLogoUrl from '../../.github/assets/icon.svg';

/** Identity mark per agent (DL-25.2), same choice as the session-history
 *  screen's own row so the two surfaces read as one system. */
const SESSION_AGENT_ICON = { claude: Robot, codex: Terminal } as const;

/** The caller (`app.tsx`) already slices to five before handing this prop
 *  down, but the component re-caps defensively rather than trusting that. */
const MAX_RECENT_SESSIONS_SHOWN = 5;

/** The SpaceVibe Deck logo, shown until the user sets a logo in Settings. */
function DefaultMark() {
  return <img src={defaultLogoUrl} alt="SpaceVibe Deck" />;
}

export interface OpenBoardHomeProps {
  readonly homeDir: string;
  readonly openFolderShortcut: string;
  /** Task 16's `worktree-host` capability gate — false hides the button. */
  readonly canCreateWorktree: boolean;
  readonly alive: readonly RecentWorkspace[];
  readonly missingGroup: readonly RecentWorkspace[];
  /**
   * The board's one failure line — a spawn that failed or a row whose folder
   * is gone. Null when nothing has gone wrong. Contract 2026-08-16: with the
   * config view removed this screen owns the message, because the board has
   * no other surface to put it on.
   */
  readonly notice: string | null;
  describeCombo(recent: RecentWorkspace): string;
  onPickFolder(): void;
  onCreateWorktree(): void;
  /**
   * A single click opens the row with its remembered layout and agent
   * (contract 2026-08-16) — there is no config step between the two any more.
   */
  onOpen(path: string): void;
  onRemove(paths: readonly string[]): void;
  /**
   * Past sessions whose recorded cwd falls under this workspace (spec §3.3,
   * v1). Named limitation, carried verbatim rather than solved here: a
   * session run inside a git worktree living outside the workspace path does
   * not prefix-match and will not appear under that workspace — it stays
   * reachable on the full session-history screen. Worktree mapping is future
   * work, not v1.
   *
   * Required, not optional-with-a-default: an empty default would let a
   * caller forget to wire this and render nothing forever with no signal,
   * which is worse than a type error naming the missing wire.
   */
  readonly recentSessions: readonly SessionEntry[];
  onResumeSession(entry: SessionEntry): void;
}

/**
 * Home view: centered app mark, primary actions, and the Recent list. Since
 * the config view was removed (2026-08-16) this is the board's only surface
 * apart from the create-worktree form: a row is picked and opened in one
 * click, so this screen also carries the board's failure line. Contract
 * 2026-08-14: the app's own `WorkspaceSidebar` is the one sidebar now, so
 * this view draws no rail of its own.
 */
export function OpenBoardHome({
  homeDir,
  openFolderShortcut,
  canCreateWorktree,
  alive,
  missingGroup,
  notice,
  describeCombo,
  onPickFolder,
  onCreateWorktree,
  onOpen,
  onRemove,
  recentSessions,
  onResumeSession,
}: OpenBoardHomeProps) {
  const hasRecents = alive.length > 0 || missingGroup.length > 0;
  const shownSessions = recentSessions.slice(0, MAX_RECENT_SESSIONS_SHOWN);

  /** One recents row — an li (not a button) so the remove action stays clickable. */
  function row(recent: RecentWorkspace, gone: boolean) {
    const combo = describeCombo(recent);
    return (
      <li
        key={recent.path}
        class={`row ${gone ? 'is-missing' : ''}`}
        // A missing row stays clickable and says why through the notice line
        // rather than going inert: an inert row with no explanation reads as a
        // broken click, and the folder may have come back since the scan.
        title={gone ? 'This folder is missing' : combo === '' ? undefined : `Opens as ${combo}`}
        onClick={() => onOpen(recent.path)}
      >
        <DeckIcon icon={FolderOpen} size={BOARD_ICON} class="row__ico" />
        <span class="row__body">
          <span class="row__name">{folderName(recent.path)}</span>
          <span class="row__meta">
            <span class="row__path">
              {homeDir === '' ? recent.path : tildify(recent.path, homeDir)}
            </span>
            <span class="row__time">{formatRelativeTime(recent.lastOpenedAt, Date.now())}</span>
          </span>
        </span>
        <button
          class="row__x"
          aria-label={`Remove ${folderName(recent.path)} from recents`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove([recent.path]);
          }}
        >
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </li>
    );
  }

  /**
   * One past session, resumable in place — DL-25.1: the whole row is the
   * control and its activation is the row's one job, so unlike `row()` above
   * (which grows a second `.row__x` element for remove) this one has nothing
   * else to protect and gets no second element. Reuses the same `.row`/
   * `.row__*` classes the workspace recents row already established, kept
   * keyboard-operable (`role="button"`, `tabIndex`, Enter/Space) since a real
   * `<button>` would be by default and DL-25.1 asks this row to behave as one.
   */
  function sessionRow(entry: SessionEntry) {
    const Icon = SESSION_AGENT_ICON[entry.agent];
    function resume(): void {
      onResumeSession(entry);
    }
    return (
      <li
        key={`${entry.agent}:${entry.sessionId}`}
        class="row"
        role="button"
        tabIndex={0}
        aria-label={`Resume ${SESSION_AGENT_LABELS[entry.agent]} session: ${entry.title ?? entry.sessionId}`}
        onClick={resume}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            resume();
          }
        }}
      >
        <DeckIcon icon={Icon} size={BOARD_ICON} class="row__ico" />
        <span class="row__body">
          {/* DL-25.2: name first, then where it came from and when — fixed
              order, the name truncates rather than displacing the rest. */}
          <span class="row__name">{entry.title ?? entry.sessionId}</span>
          <span class="row__meta">
            <span class="row__path">
              {SESSION_AGENT_LABELS[entry.agent]} ·{' '}
              {homeDir === '' ? entry.cwd : tildify(entry.cwd, homeDir)}
            </span>
            <span class="row__time">{formatRelativeTime(entry.lastActivityMs, Date.now())}</span>
          </span>
        </span>
      </li>
    );
  }

  return (
    <div class="board-home">
      <span class="applogo applogo--lg">
        {logoDataUrl.value === '' ? (
          <DefaultMark />
        ) : (
          <img src={logoDataUrl.value} alt="App logo" />
        )}
      </span>
      <div class="board-home__actions">
        <button class="home-action" onClick={onPickFolder}>
          <DeckIcon icon={FolderPlus} size={ROW_ICON} />
          Open project<kbd>{openFolderShortcut}</kbd>
        </button>
        {canCreateWorktree ? (
          <button class="home-action" onClick={onCreateWorktree}>
            <DeckIcon icon={GitBranch} size={ROW_ICON} />
            Create worktree
          </button>
        ) : null}
      </div>
      {/* DL-3.2: the board's only warning, and the only place a failed open
          is ever said — `role="status"` so it reaches a screen reader too. */}
      {notice !== null ? (
        <p class="board-home__notice" role="status">
          {notice}
        </p>
      ) : null}
      {hasRecents ? (
        <div class="board-home__recents">
          <div class="board-home__recents-head">Recent</div>
          <ul class="board-home__list" aria-label="Recent workspaces">
            {alive.map((recent) => row(recent, false))}
            {missingGroup.length > 0 ? (
              <li class="gsep">
                <span>Missing</span>
                <button onClick={() => onRemove(missingGroup.map((r) => r.path))}>
                  Remove {missingGroup.length}
                </button>
              </li>
            ) : null}
            {missingGroup.map((recent) => row(recent, true))}
          </ul>
        </div>
      ) : null}
      {/* No empty state here on purpose: an empty "Recent sessions" heading
          on a workspace with none would be noise, not information. */}
      {shownSessions.length > 0 ? (
        <div class="board-home__recents">
          <div class="board-home__recents-head">Recent sessions</div>
          <ul class="board-home__list" aria-label="Recent sessions">
            {shownSessions.map((entry) => sessionRow(entry))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
