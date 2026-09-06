import { ClockCounterClockwise, FolderOpen, FolderPlus, GitBranch, X } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { BOARD_ICON, DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { GithubStarButton } from "../ui/controls/github-star-button";
import { formatRelativeTime, type RecentWorkspace } from "../lib/workspace-recents";
import { workspaceLabel } from "../lib/workspace-label";
import { tildify } from "../lib/process-info";
import { logoDataUrl } from "../settings/logo-store";
import defaultLogoUrl from "../../.github/assets/icon.svg";

/** What a row's badge shows about an unrunnable agent, and its hover sentence. */
export interface StaleAgentNote {
  readonly badge: string;
  readonly detail: string;
}

/** The SpaceVibe Deck logo, shown until the user sets a logo in Settings. */
function DefaultMark() {
  return <img src={defaultLogoUrl} alt="SpaceVibe Deck" />;
}

export interface OpenBoardHomeProps {
  readonly homeDir: string;
  readonly openFolderShortcut: string;
  /** Task 16's `worktree-host` capability gate — false hides the button. */
  readonly canCreateWorktree: boolean;
  /** Electron Sessions capability gate — false omits the history entry. */
  readonly canBrowseSessions: boolean;
  readonly alive: readonly RecentWorkspace[];
  readonly missingGroup: readonly RecentWorkspace[];
  /** Workspace tags on live tabs. A match means this click starts another. */
  readonly openWorkspacePaths: ReadonlySet<string>;
  /** The one workspace-open attempt currently in flight. */
  readonly opening: boolean;
  /**
   * The board's one failure line — a spawn that failed or a row whose folder
   * is gone. Null when nothing has gone wrong. Contract 2026-08-16: with the
   * config view removed this screen owns the message, because the board has
   * no other surface to put it on.
   */
  readonly notice: string | null;
  /**
   * A launch this board is holding back because the agent it would run is not
   * the agent the row names — the sentence to show, or null when nothing is
   * held. It replaces the notice while it stands (one message slot, and the
   * board clears the notice before ever setting this), and it is the only
   * thing on this screen a person must answer.
   */
  readonly decision: string | null;
  describeCombo(recent: RecentWorkspace): string;
  /**
   * What to say about a remembered agent that cannot run — uninstalled, or
   * switched off in Settings, which are different failures with different
   * fixes. Null when it can run, and null while discovery has not answered:
   * an unanswered probe must not annotate every row.
   */
  staleAgent(recent: RecentWorkspace): StaleAgentNote | null;
  onPickFolder(): void;
  onCreateWorktree(): void;
  onBrowseSessions(): void;
  /**
   * A single click opens the row with its remembered layout and agent
   * (contract 2026-08-16) — there is no config step between the two any more.
   */
  onOpen(path: string): void;
  onRemove(paths: readonly string[]): void;
  /** `Open anyway` — launch the substitute the decision line just named. */
  onConfirmOpen(): void;
  /** `Manage agents…` — Settings, the only place a dead memory is fixable. */
  onManageAgents(): void;
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
  canBrowseSessions,
  alive,
  missingGroup,
  openWorkspacePaths,
  opening,
  notice,
  decision,
  describeCombo,
  staleAgent,
  onPickFolder,
  onCreateWorktree,
  onBrowseSessions,
  onOpen,
  onRemove,
  onConfirmOpen,
  onManageAgents,
}: OpenBoardHomeProps) {
  const hasRecents = alive.length > 0 || missingGroup.length > 0;
  const missingExpanded = useSignal(false);

  /** One recent: separate sibling buttons, never a button nested in a button. */
  function row(recent: RecentWorkspace, gone: boolean) {
    const combo = describeCombo(recent);
    const stale = staleAgent(recent);
    const name = workspaceLabel(recent.path);
    const alreadyOpen = openWorkspacePaths.has(recent.path);
    return (
      <li key={recent.path} class={`row ${gone ? "is-missing" : ""}`}>
        <button
          type="button"
          class="row__open"
          disabled={opening}
          aria-label={alreadyOpen ? `Start another session in ${name}` : `Open workspace ${name}`}
          onClick={() => onOpen(recent.path)}
        >
          <DeckIcon icon={FolderOpen} size={BOARD_ICON} class="row__ico" />
          <span class="row__body">
            <span class="row__headline">
              <span class="row__name">{name}</span>
              {alreadyOpen ? <span class="row__state">Open</span> : null}
            </span>
            <span class="row__meta">
              <span class="row__path">
                {homeDir === "" ? recent.path : tildify(recent.path, homeDir)}
              </span>
              {combo === "" ? null : <span class="row__combo">{combo}</span>}
              {/* DL-3.2: `--yellow` is attention a person must act on, which
                  is exactly what a remembered agent that can no longer run
                  is. Said on the ROW, before the click — the decision line
                  below repeats it only for the click that ignores it. */}
              {stale === null ? null : (
                <span class="row__stale" title={stale.detail}>
                  {stale.badge}
                </span>
              )}
              <span class="row__time">{formatRelativeTime(recent.lastOpenedAt, Date.now())}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          class="row__x"
          aria-label={`Remove ${name} from recents`}
          onClick={() => onRemove([recent.path])}
        >
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </li>
    );
  }

  return (
    <div class="board-home" aria-busy={opening}>
      <span class="applogo applogo--lg">
        {logoDataUrl.value === "" ? (
          <DefaultMark />
        ) : (
          <img src={logoDataUrl.value} alt="App logo" />
        )}
      </span>
      <h1 class="board-home__title">Start a workspace</h1>
      <div class="board-home__actions">
        <button
          type="button"
          class="home-action home-action--primary"
          disabled={opening}
          onClick={onPickFolder}
        >
          <DeckIcon icon={FolderPlus} size={ROW_ICON} />
          Open workspace…<kbd>{openFolderShortcut}</kbd>
        </button>
        {canCreateWorktree ? (
          <button
            type="button"
            class="home-action home-action--secondary"
            disabled={opening}
            onClick={onCreateWorktree}
          >
            <DeckIcon icon={GitBranch} size={ROW_ICON} />
            Create worktree
          </button>
        ) : null}
      </div>
      {canBrowseSessions ? (
        <button
          type="button"
          class="board-home__resume"
          disabled={opening}
          onClick={onBrowseSessions}
        >
          <DeckIcon icon={ClockCounterClockwise} size={ROW_ICON} />
          Resume a previous session…
        </button>
      ) : null}
      {/* The one thing Deck ever asks for. It is a resting call to action, not
          a state (DL-3.1: `--accent` marks the interactive), and it stands on
          its own row rather than joining the actions above — opening a
          workspace is the work, this is not. It renders nothing once the ask
          is answered — and comes back if the account stops starring, which is
          the recheck's whole reason for existing. */}
      <GithubStarButton variant="board" disabled={opening} />
      {opening ? (
        <p class="board-home__opening" role="status">
          Opening workspace…
        </p>
      ) : null}
      {/* DL-3.2: the board's only warning, and the only place a failed open
          is ever said — `role="status"` so it reaches a screen reader too. */}
      {notice !== null ? (
        <p class="board-home__notice" role="status">
          {notice}
        </p>
      ) : null}
      {/* The board's second message shape, and the only one that asks rather
          than reports: `role="alert"` because it INTERRUPTS a launch the user
          already asked for, where the notice above only describes one that
          did not happen. Both ways forward are here — the open the user meant,
          and the catalog where the missing CLI is fixed. */}
      {decision !== null ? (
        <div class="board-home__decision" role="alert">
          <p class="board-home__decision-text">{decision}</p>
          <div class="board-home__decision-actions">
            <button
              type="button"
              class="board-home__decision-go"
              disabled={opening}
              onClick={onConfirmOpen}
            >
              Open anyway
            </button>
            <button
              type="button"
              class="board-home__decision-fix"
              disabled={opening}
              onClick={onManageAgents}
            >
              Manage agents…
            </button>
          </div>
        </div>
      ) : null}
      {hasRecents ? (
        <div class="board-home__recents">
          <div class="board-home__recents-head">Recent workspaces</div>
          <ul class="board-home__list" aria-label="Recent workspaces">
            {alive.map((recent) => row(recent, false))}
            {missingGroup.length > 0 ? (
              <li class="gsep">
                <button
                  type="button"
                  class="board-home__missing-toggle"
                  aria-expanded={missingExpanded.value}
                  onClick={() => {
                    missingExpanded.value = !missingExpanded.value;
                  }}
                >
                  Missing workspaces ({missingGroup.length})
                </button>
                <button
                  type="button"
                  class="gsep__remove"
                  onClick={() => onRemove(missingGroup.map((r) => r.path))}
                >
                  Remove {missingGroup.length}
                </button>
              </li>
            ) : null}
            {missingExpanded.value ? missingGroup.map((recent) => row(recent, true)) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
