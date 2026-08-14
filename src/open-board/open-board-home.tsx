import { FolderOpen, FolderPlus, GitBranchPlus, X } from "lucide-preact";
import { BOARD_ICON, DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { folderName, formatRelativeTime } from "../lib/workspace-recents";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { tildify } from "../lib/process-info";
import { logoDataUrl } from "../settings/logo-store";

/** The default Deck mark, shown until the user sets a logo in Settings. */
function DefaultMark() {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="Deck">
      <rect x="6" y="6" width="16" height="16" rx="2" />
      <rect x="26" y="6" width="16" height="16" rx="2" />
      <rect x="6" y="26" width="16" height="16" rx="2" />
      <rect x="26" y="26" width="16" height="16" rx="2" />
    </svg>
  );
}

export interface OpenBoardHomeProps {
  readonly homeDir: string;
  readonly openFolderShortcut: string;
  /** Task 16's `worktree-host` capability gate — false hides the button. */
  readonly canCreateWorktree: boolean;
  readonly alive: readonly RecentWorkspace[];
  readonly missingGroup: readonly RecentWorkspace[];
  describeCombo(recent: RecentWorkspace): string;
  onPickFolder(): void;
  /** A single click picks the row and switches to the config view. */
  onSelect(path: string): void;
  /** A double click picks the row and opens it with its remembered combo. */
  onOpen(path: string): void;
  onRemove(paths: readonly string[]): void;
}

/**
 * Home view: centered app mark, primary actions, and the Recent list — the
 * board's only surface until a workspace is picked. Contract 2026-08-14: the
 * app's own `WorkspaceSidebar` is the one sidebar now, so this view draws no
 * rail of its own.
 */
export function OpenBoardHome({
  homeDir,
  openFolderShortcut,
  canCreateWorktree,
  alive,
  missingGroup,
  describeCombo,
  onPickFolder,
  onSelect,
  onOpen,
  onRemove,
}: OpenBoardHomeProps) {
  const hasRecents = alive.length > 0 || missingGroup.length > 0;

  /** One recents row — an li (not a button) so the remove action stays clickable. */
  function row(recent: RecentWorkspace, gone: boolean) {
    const combo = describeCombo(recent);
    return (
      <li
        key={recent.path}
        class={`row ${gone ? "is-missing" : ""}`}
        title={combo === "" ? undefined : `Opens as ${combo}`}
        onClick={() => onSelect(recent.path)}
        onDblClick={() => onOpen(recent.path)}
      >
        <DeckIcon icon={FolderOpen} size={BOARD_ICON} class="row__ico" />
        <span class="row__body">
          <span class="row__name">{folderName(recent.path)}</span>
          <span class="row__meta">
            <span class="row__path">
              {homeDir === "" ? recent.path : tildify(recent.path, homeDir)}
            </span>
            <span class="row__time">
              {formatRelativeTime(recent.lastOpenedAt, Date.now())}
            </span>
          </span>
        </span>
        <button
          class="row__x"
          aria-label={`Remove ${folderName(recent.path)} from recents`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove([recent.path]);
          }}
          // A second rapid click fires dblclick — without this it bubbles
          // to the row's onDblClick and opens the workspace.
          onDblClick={(event) => event.stopPropagation()}
        >
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </li>
    );
  }

  return (
    <div class="board-home">
      <span class="applogo applogo--lg">
        {logoDataUrl.value === "" ? (
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
          <button class="home-action" onClick={onPickFolder}>
            <DeckIcon icon={GitBranchPlus} size={ROW_ICON} />
            Create worktree
          </button>
        ) : null}
      </div>
      {hasRecents ? (
        <div class="board-home__recents">
          <div class="board-home__recents-head">Recent</div>
          <ul class="board-home__list" aria-label="Recent workspaces">
            {alive.map((recent) => row(recent, false))}
            {missingGroup.length > 0 ? (
              <li class="gsep">
                <span>Missing</span>
                <button
                  onClick={() => onRemove(missingGroup.map((r) => r.path))}
                >
                  Remove {missingGroup.length}
                </button>
              </li>
            ) : null}
            {missingGroup.map((recent) => row(recent, true))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
