import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Plus,
  RefreshCw,
  X,
} from "lucide-preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  activeTabIndex,
  statusInfo,
  tabViews,
} from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon, RAIL_ICON } from "./controls/deck-icon";
import { tildify } from "../lib/process-info";
import { type TabDotColor } from "../lib/tab-colors";
import { installFileDrop } from "../terminal/file-drop";
import { reportPersistError } from "../chrome/events";
import { WorktreeAgentStack } from "./worktree-agent-stack";
import {
  collapsedRepositories,
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  invalidateRepositoryScans,
  repositoryScans,
  toggleRepositoryCollapsed,
} from "../repositories/repositories-store";
import { sessionArchive } from "../terminal/session-journal";
import {
  buildRail,
  filterRailToWorkspaceHistory,
  type WorktreeRow,
} from "../repositories/repository-model";
import { open } from "../host/dialog-host";
import { available as electronHostAvailable } from "../host/worktree-host";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { workspacesData } from "../open-board/workspaces-store";
import { SidebarBanner } from "./sidebar-banner";

/**
 * The repository → worktree navigation rail.
 *
 * Design: `docs/specs/2026-08-13-repository-worktree-rail-design.md`.
 *
 * It occupies `DesktopChrome`'s existing `sidebarNavigation` slot and keeps
 * `WorkspaceSidebar`'s callback contract exactly — same six props, same
 * meanings (including the 2026-08-14 rename of the footer row's callback to
 * `onOpenWorkspace`, applied to both so the shapes stay identical). That is
 * deliberate: a rail that also changed what selecting or closing a tab means
 * would be a change to tab coordination (R4), and this is a change to
 * presentation. `WorkspaceSidebar` stays in the tree beside it, so reverting
 * is one line in `app.tsx`.
 *
 * What is NOT here, and why: opening a worktree that has no tab AND no
 * archived session. That materializes a tab from a path the user chose no
 * layout and no agent for, which is `AGENTS.md`'s tab-materialization fork —
 * still unapproved. A worktree WITH an archived session is a different case:
 * `docs/plans/2026-08-15-session-restore.md` (Task 9; fork queue entry in
 * `AGENTS.md`, Task 11) resolves it by rebuilding that recorded session
 * instead of materializing a fresh, unspecified one, so its empty row becomes
 * pressable through `onResumeWorktree`. Every other empty row stays a
 * **readout** — DL-17.3's precedent, where a control that cannot be pressed
 * drops its border rather than gaining a disabled pill, because a border is
 * what promises "you can press this" everywhere else in the app.
 */

interface RepositoryRailProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  /**
   * Footer "Open workspace" row: the Open board's full workspace/preset/
   * agent flow. Distinct from the tab strip's `+` (AgentQuickPicker,
   * `TabManager.newTab()`) since this row opens a NEW workspace rather than
   * a fast pick in the active one — same distinction the design that split
   * them draws.
   */
  onOpenWorkspace(): void;
  onFocusAttention?(index: number): void;
  /** A resumable row was clicked: rebuild that worktree's archived session. */
  onResumeWorktree(path: string): void;
  /** Test/gallery override; production defaults to the Electron host marker. */
  showAgentPresence?: boolean;
  /**
   * Pinned under the scrolling list and above the banner: the rail's own
   * footer of window actions (`SidebarActions`, DL §28). `App` builds it,
   * the same way it builds the toolbar once for both layouts.
   */
  footer?: ComponentChildren;
  /**
   * The same `SurfaceStrip` wired into `TabManager` (Task 5), read for one
   * thing only: whether a file surface holds the stage, which decides whether
   * a tab row still draws as the active one. The rail lists no file tabs and
   * opens none — it never learns what a file IS.
   */
  fileController: FileSurfaceController;
}

/** Accessible wording for each state — colour is never the only carrier. */
const STATE_LABEL: Record<WorktreeRow["state"], string> = {
  missing: "missing from disk",
  attention: "needs attention",
  working: "agents working",
  ready: "open",
  idle: "not open",
};

interface WorktreeStateDotProps {
  readonly state: WorktreeRow["state"];
  readonly label: string;
  readonly onActivate?: () => void;
}

/** Hollow status ring; colour carries the visual state, text carries a11y. */
function WorktreeStateDot({ state, label, onActivate }: WorktreeStateDotProps) {
  const stateLabel = STATE_LABEL[state];
  if (state === "attention" && onActivate !== undefined) {
    return (
      <button
        type="button"
        class="wsitem__state"
        aria-label={`${label}: ${stateLabel}`}
        title={stateLabel}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
      />
    );
  }
  return (
    <span
      class="wsitem__state"
      role="status"
      aria-label={`${label}: ${stateLabel}`}
      title={stateLabel}
    />
  );
}

export function RepositoryRail(props: RepositoryRailProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const home = statusInfo.value.home;
  const showAgentPresence = props.showAgentPresence ?? electronHostAvailable;
  // A file surface can hold the stage while `tab.active`/`active` still name
  // whichever terminal tab it sits on top of (selecting a file never touches
  // `TabManager`'s own `active` index) — so a tab row is only the VISIBLE
  // active row when neither is true.
  //
  // The rail does NOT list file tabs. It answers "which repository and
  // worktree is this session in"; "which documents are open" is the stage
  // strip's question, and it is the only place that answers it (2026-08-14).
  const surfaceActive = props.fileController.activeIndex() >= 0;

  const groups = filterRailToWorkspaceHistory(
    buildRail({
      tabs,
      activeIndex: active,
      scans: repositoryScans.value,
      collapsed: collapsedRepositories.value,
      archivedPaths: new Set(Object.keys(sessionArchive.value)),
    }),
    workspacesData.value.recents.map((recent) => recent.path),
  );
  const lastSelectedTabKeys = useSignal<ReadonlyMap<string, number>>(new Map());
  const selectedWorktree = groups
    .flatMap((group) => group.worktrees)
    .find((worktree) => worktree.tabs.some((tab) => tab.active));
  const selectedTab = selectedWorktree?.tabs.find((tab) => tab.active);

  // Remember one terminal per worktree for the broad row target. Agent marks
  // still focus an exact tab; leaving and returning to the row restores that
  // choice instead of falling back to its first tab every time.
  useEffect(() => {
    if (selectedWorktree === undefined || selectedTab === undefined) {
      return;
    }
    if (
      lastSelectedTabKeys.value.get(selectedWorktree.id) === selectedTab.key
    ) {
      return;
    }
    lastSelectedTabKeys.value = new Map([
      ...lastSelectedTabKeys.value,
      [selectedWorktree.id, selectedTab.key],
    ]);
  }, [selectedWorktree?.id, selectedTab?.key]);
  // Repository scans: on demand for every open workspace, and again whenever
  // the window comes back (spec §2 — the invalidation that replaces a watcher).
  useEffect(() => installRepositoryRescanOnFocus(), []);
  useSignalEffect(() => {
    ensureRepositoriesScanned(
      tabViews.value
        .map((tab) => tab.workspacePath)
        .filter((path): path is string => path !== null),
    );
  });

  /** The quiet line under a row's name (DL-3.4). The branch is the name. */
  function subtitle(worktree: WorktreeRow): string {
    return worktree.path === "" ? "" : tildify(worktree.path, home);
  }

  function worktreeRow(worktree: WorktreeRow, tiered: boolean) {
    const activeTab = worktree.tabs.find((tab) => tab.active);
    const rememberedTab = worktree.tabs.find(
      (tab) => tab.key === lastSelectedTabKeys.value.get(worktree.id),
    );
    const primaryTab = activeTab ?? rememberedTab ?? worktree.tabs[0];
    const attentionTab = worktree.tabs.find(
      (tab) => tab.attention.actionableCount > 0,
    );
    // A file surface on top means the worktree is no longer the visible
    // active row, even though TabManager still names one of its tabs.
    const visiblyActive = activeTab !== undefined && !surfaceActive;
    return (
      <div
        key={worktree.id}
        role="tab"
        aria-selected={visiblyActive}
        tabIndex={0}
        data-key={primaryTab.key}
        data-workspace={primaryTab.workspacePath ?? ""}
        data-state={worktree.state}
        class={`wsitem ${visiblyActive ? "is-active" : ""}`}
        onClick={() => {
          // The exact tab is chosen by its agent button. The worktree body is
          // the broad target for its active tab, falling back to the first tab
          // when this worktree is not active in the window. Pressing the row
          // of the tab already showing used to raise `TabPopover`; that
          // component was removed on 2026-08-16, so it is a plain select now.
          props.onSelectTab((activeTab ?? primaryTab).index);
        }}
      >
        <WorktreeStateDot
          state={worktree.state}
          label={worktree.name}
          onActivate={
            attentionTab !== undefined && props.onFocusAttention
              ? () => props.onFocusAttention!(attentionTab.index)
              : undefined
          }
        />
        <span class="wsitem__text">
          <span class="wsitem__label">
            <span class="wsitem__name">{worktree.name}</span>
            {tiered && worktree.primary && (
              <span class="wsitem__badge">primary</span>
            )}
          </span>
          {/* U+200E keeps the path LTR inside the RTL (head-ellipsis)
              container — without it the leading "~" flips to the end. */}
          <span class="wsitem__path">{`‎${subtitle(worktree)}`}</span>
        </span>
        {showAgentPresence && (
          <WorktreeAgentStack
            tabs={worktree.tabs}
            onSelectTab={props.onSelectTab}
          />
        )}
        {activeTab !== undefined && (
          <button
            type="button"
            class="wsitem__close"
            aria-label={`Close active tab in ${worktree.name}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onCloseTab(activeTab.index);
            }}
          >
            <DeckIcon icon={X} size={CHROME_ICON} />
          </button>
        )}
      </div>
    );
  }

  /**
   * A previously opened worktree with no current session. DL-17.3: no border,
   * `--text-faint`, because a border promises "you can press this" and opening
   * this row is §7.1's fork.
   */
  function readoutRow(worktree: WorktreeRow, tiered: boolean) {
    const lock =
      worktree.locked === null
        ? ""
        : worktree.locked === ""
          ? " · locked"
          : ` · locked: ${worktree.locked}`;
    return (
      <div
        key={worktree.id}
        class="wsitem wsitem--readout"
        data-state={worktree.state}
        aria-label={`${worktree.name}: ${STATE_LABEL[worktree.state]}`}
        title={
          worktree.state === "missing"
            ? "This worktree is gone from disk. Deck reports it and never prunes it."
            : "Open this worktree from the Open board."
        }
      >
        <WorktreeStateDot state={worktree.state} label={worktree.name} />
        <span class="wsitem__text">
          <span class="wsitem__label">
            <span class="wsitem__name">{worktree.name}</span>
            {tiered && worktree.primary && (
              <span class="wsitem__badge">primary</span>
            )}
          </span>
          <span class="wsitem__path">{`‎${subtitle(worktree)}${lock}`}</span>
        </span>
      </div>
    );
  }

  /**
   * A previously opened worktree with no current session, but a recorded one
   * in `sessionArchive` — DL-21.1/21.2: full `.wsitem` genre (no
   * `--readout` modifier), so it carries the same hover/selection washes as a
   * live row, because unlike the plain readout this one IS pressable.
   * Resolves the "unapproved fork" this file's header used to name — see its
   * doc comment.
   */
  function resumableRow(worktree: WorktreeRow, tiered: boolean) {
    const activate = () => props.onResumeWorktree(worktree.path);
    return (
      <div
        key={worktree.id}
        class="wsitem"
        data-state={worktree.state}
        tabIndex={0}
        role="button"
        aria-label={`Resume last session in ${worktree.name}`}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
      >
        <WorktreeStateDot state="idle" label={worktree.name} />
        <span class="wsitem__text">
          <span class="wsitem__label">
            <span class="wsitem__name">{worktree.name}</span>
            {tiered && worktree.primary && (
              <span class="wsitem__badge">primary</span>
            )}
          </span>
          <span class="wsitem__path">{`‎${subtitle(worktree)}`}</span>
        </span>
      </div>
    );
  }

  /**
   * Exactly one row per worktree. Open tabs become focusable agent buttons
   * inside that row; an empty worktree with an archived session becomes a
   * pressable resume row; every other empty worktree stays a readout.
   */
  function worktreeRows(worktree: WorktreeRow, tiered: boolean) {
    if (worktree.tabs.length > 0) {
      return [worktreeRow(worktree, tiered)];
    }
    return [
      worktree.resumable
        ? resumableRow(worktree, tiered)
        : readoutRow(worktree, tiered),
    ];
  }

  return (
    <nav class="wsbar wsbar--repos" aria-label="Repositories">
      <div class="wsbar__list" role="tablist" aria-label="Workspace tabs">
        {groups.map((group) =>
          // A folder that is not a repository does not sprout a repository
          // tier. It renders as the bare row Deck has always shown — the rail
          // adds a tier where git says there is one, and nowhere else.
          group.kind === "plain" ? (
            <div key={group.key} class="repogroup repogroup--plain">
              {group.worktrees.map((worktree) => worktreeRows(worktree, false))}
            </div>
          ) : (
            <section key={group.key} class="repogroup">
              <header class="repogroup__head">
                <button
                  type="button"
                  class="repogroup__toggle"
                  aria-expanded={!group.collapsed}
                  onClick={() => toggleRepositoryCollapsed(group.key)}
                >
                  <span class="repogroup__mark" aria-hidden="true">
                    <DeckIcon icon={FolderGit2} size={RAIL_ICON} />
                  </span>
                  <span class="repogroup__name">{group.name}</span>
                  <DeckIcon
                    icon={group.collapsed ? ChevronRight : ChevronDown}
                    size={CHROME_ICON}
                  />
                </button>
                <button
                  type="button"
                  class="repogroup__action"
                  aria-label={`Rescan ${group.name}`}
                  title="Rescan worktrees"
                  onClick={invalidateRepositoryScans}
                >
                  <DeckIcon icon={RefreshCw} size={CHROME_ICON} />
                </button>
              </header>
              {!group.collapsed && (
                <div class="repogroup__worktrees">
                  {group.worktrees.map((worktree) =>
                    worktreeRows(worktree, true),
                  )}
                </div>
              )}
            </section>
          ),
        )}
        <button
          type="button"
          class="wsbar__add"
          title="Open a workspace, worktree, or layout preset"
          aria-label="Open workspace"
          onClick={props.onOpenWorkspace}
        >
          <span class="wsbar__add-glyph">
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </span>
          {/* Classed so the collapsed rail can drop the words and keep the
              glyph (DL-18.9); `aria-label` above already carries the name. */}
          <span class="wsbar__add-label">Open workspace</span>
        </button>
      </div>
      {props.footer}
      <SidebarBanner />
    </nav>
  );
}
