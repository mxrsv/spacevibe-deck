import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Plus,
  RefreshCw,
  X,
} from "lucide-preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  activeTabIndex,
  requestTabOptionsKey,
  statusInfo,
  tabViews,
} from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon, RAIL_ICON } from "./controls/deck-icon";
import { tildify } from "../lib/process-info";
import { type TabDotColor } from "../lib/tab-colors";
import { installFileDrop } from "../terminal/file-drop";
import {
  clearWorkspaceLogo,
  ensureFaviconScanned,
  hasCustomWorkspaceLogo,
  setWorkspaceLogoFromPath,
} from "../settings/workspace-logo-store";
import { pickImagePath } from "../settings/logo-store";
import { reportPersistError, tabPopoverOpen } from "../chrome/events";
import { TabPopover } from "./tab-popover";
import { WorkspaceLogo } from "./workspace-logo";
import { titleWithShortcut } from "../lib/shortcut-label";
import {
  collapsedRepositories,
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  invalidateRepositoryScans,
  repositoryScans,
  toggleRepositoryCollapsed,
} from "../repositories/repositories-store";
import {
  buildRail,
  type RailTab,
  type WorktreeRow,
} from "../repositories/repository-model";
import { open } from "../host/dialog-host";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { activeWorkspace } from "../files/file-surface-store";
import { fileTabViews, type TabViewModel } from "../files/file-tab-views";

/**
 * The repository → worktree navigation rail.
 *
 * Design: `docs/specs/2026-08-13-repository-worktree-rail-design.md`.
 *
 * It occupies `DesktopChrome`'s existing `sidebarNavigation` slot and keeps
 * `WorkspaceSidebar`'s callback contract exactly — same six props, same
 * meanings. That is deliberate: a rail that also changed what selecting or
 * closing a tab means would be a change to tab coordination (R4), and this is
 * a change to presentation. `WorkspaceSidebar` stays in the tree beside it, so
 * reverting is one line in `app.tsx`.
 *
 * What is NOT here, and why: opening a worktree that has no tab. That
 * materializes a tab from a path the user chose no layout and no agent for,
 * which is `AGENTS.md`'s tab-materialization fork. Until it is approved such a
 * row is a **readout** — DL-17.3's precedent, where a control that cannot be
 * pressed drops its border rather than gaining a disabled pill, because a
 * border is what promises "you can press this" everywhere else in the app.
 */

interface RepositoryRailProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  onFocusAttention?(index: number): void;
  /**
   * The same `SurfaceStrip` wired into `TabManager` (Task 5) — read here only
   * for `fileTabViews`'s projection and the `activate`/`closePath` calls its
   * own rows need. The rail never learns what a file IS, only what this
   * projects (spec §2.3's seam, extended to the renderer).
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

export function RepositoryRail(props: RepositoryRailProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const home = statusInfo.value.home;
  // A file surface can hold the stage while `tab.active`/`active` still name
  // whichever terminal tab it sits on top of (selecting a file never touches
  // `TabManager`'s own `active` index) — so a tab row is only the VISIBLE
  // active row when neither is true.
  const fileTabs = fileTabViews(props.fileController);
  const surfaceActive = props.fileController.activeIndex() >= 0;
  const navRef = useRef<HTMLElement>(null);
  const dragOverKey = useSignal<number | null>(null);
  // Anchored by tab key, not index — tabs can close (and indexes shift) while
  // the popover is open. Same reasoning as the tab bar and the old sidebar.
  const popover = useSignal<{
    key: number;
    left: number;
    top: number;
    anchorEl: HTMLElement;
  } | null>(null);

  const groups = buildRail({
    tabs,
    activeIndex: active,
    scans: repositoryScans.value,
    collapsed: collapsedRepositories.value,
  });
  // `buildRail` derives every row from OPEN TABS (`RailInput.tabs`) — a
  // workspace with none gets no worktree row at all, group included. That is
  // exactly the "last surface, not last tab" case (spec §7): the window's
  // last terminal tab of `activeWorkspace` can close while its file tabs
  // stay open, and `worktreeRows` below has nothing to attach them to. The
  // fallback section past `groups.map` below covers it — this flag decides
  // whether that fallback is needed.
  const activeWorkspaceHasRow = groups.some((group) =>
    group.worktrees.some((worktree) => worktree.path === activeWorkspace.value),
  );

  // The browser panel's native view has to be hidden while anything floats
  // over the stage, and it cannot see a component-local signal.
  useSignalEffect(() => {
    tabPopoverOpen.value = popover.value !== null;
  });

  const popoverTab =
    popover.value === null
      ? undefined
      : tabs.find((tab) => tab.key === popover.value?.key);
  const resolvePopoverIndex = (): number =>
    popover.value === null
      ? -1
      : tabs.findIndex((tab) => tab.key === popover.value?.key);

  // Scan each open workspace for a favicon once — the default logo source.
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.workspacePath !== null) {
        ensureFaviconScanned(tab.workspacePath);
      }
    }
  }, [tabs]);

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

  // Drop an image onto a workspace row → that workspace's custom logo.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    function rowAt(x: number, y: number): HTMLElement | null | undefined {
      return document.elementFromPoint(x, y)?.closest<HTMLElement>(".wsitem");
    }

    installFileDrop({
      onOver(x, y) {
        const key = rowAt(x, y)?.dataset.key;
        dragOverKey.value = key === undefined ? null : Number(key);
      },
      onLeave() {
        dragOverKey.value = null;
      },
      onDrop(x, y, paths) {
        dragOverKey.value = null;
        const workspacePath = rowAt(x, y)?.dataset.workspace || null;
        if (workspacePath === null) {
          return; // not a workspace row — leave it to the terminal/logo panel
        }
        const image = pickImagePath(paths);
        if (image === null) {
          reportPersistError("Use a .png, .jpg, .svg or .webp image");
          return;
        }
        setWorkspaceLogoFromPath(workspacePath, image).catch((err: unknown) => {
          reportPersistError(
            err instanceof Error ? err.message : "Couldn't set the logo",
          );
        });
      },
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err: unknown) => {
        console.warn("Failed to install workspace logo drop:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function openPopover(key: number, anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    popover.value = { key, left: rect.right + 6, top: rect.top, anchorEl };
  }

  // The open-tab-options shortcut doesn't know which navigation surface is
  // mounted, so it arrives through this shared signal.
  useSignalEffect(() => {
    const key = requestTabOptionsKey.value;
    if (key === null) {
      return;
    }
    const anchorEl = navRef.current?.querySelector<HTMLElement>(
      `[data-key="${key}"]`,
    );
    if (anchorEl) {
      openPopover(key, anchorEl);
    }
    requestTabOptionsKey.value = null;
  });

  async function pickLogoFor(workspacePath: string): Promise<void> {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Image", extensions: ["png", "jpg", "jpeg", "svg", "webp"] },
        ],
      });
      if (typeof picked === "string") {
        await setWorkspaceLogoFromPath(workspacePath, picked);
      }
    } catch (err: unknown) {
      reportPersistError(
        err instanceof Error ? err.message : "Couldn't set the logo",
      );
    }
  }

  /** The quiet line under a row's name (DL-3.4). The branch is the name. */
  function subtitle(worktree: WorktreeRow): string {
    return worktree.path === "" ? "" : tildify(worktree.path, home);
  }

  function tabRow(worktree: WorktreeRow, tab: RailTab, tiered: boolean) {
    // The user's own name wins; otherwise the row is named after the worktree
    // it stands for, not after the folder the tab happens to point at.
    const label = tab.customName ?? worktree.name;
    // A file surface on top means THIS row is no longer the visible active
    // one, even though `tab.active` (TabManager's own `active` index) still
    // names it — see the file-level comment on `surfaceActive` above.
    const visiblyActive = tab.active && !surfaceActive;
    return (
      <div
        key={tab.key}
        role="tab"
        aria-selected={visiblyActive}
        tabIndex={0}
        data-key={tab.key}
        data-workspace={tab.workspacePath ?? ""}
        data-state={worktree.state}
        class={`wsitem ${visiblyActive ? "is-active" : ""} ${dragOverKey.value === tab.key ? "is-drag-over" : ""}`}
        onClick={(event) => {
          // A file surface sitting on top of THIS same tab still needs the
          // click to take the stage back — `tab.active` alone would open the
          // rename popover instead (spec §7, "selecting a terminal tab takes
          // the stage back").
          if (!tab.active || surfaceActive) {
            props.onSelectTab(tab.index);
            return;
          }
          if (popover.value?.key === tab.key) {
            popover.value = null;
            return;
          }
          openPopover(tab.key, event.currentTarget as HTMLElement);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openPopover(tab.key, event.currentTarget as HTMLElement);
        }}
      >
        <WorkspaceLogo
          workspacePath={tab.workspacePath}
          label={label}
          pending={tab.agentBusy}
          unread={tab.unread}
          attention={tab.attention}
          onFocusAttention={
            props.onFocusAttention
              ? () => props.onFocusAttention!(tab.index)
              : undefined
          }
        />
        <span class="wsitem__text">
          <span class="wsitem__label">
            <span class="wsitem__name">{label}</span>
            {tiered && worktree.primary && (
              <span class="wsitem__badge">primary</span>
            )}
          </span>
          {/* U+200E keeps the path LTR inside the RTL (head-ellipsis)
              container — without it the leading "~" flips to the end. */}
          <span class="wsitem__path">{`‎${subtitle(worktree)}`}</span>
        </span>
        <button
          type="button"
          class="wsitem__close"
          aria-label="Close workspace"
          onClick={(event) => {
            event.stopPropagation();
            props.onCloseTab(tab.index);
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }

  /**
   * A worktree with no session. DL-17.3: no border, `--text-faint`, because a
   * border promises "you can press this" and opening this row is §7.1's fork.
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
        <span class="wsitem__state" aria-hidden="true" />
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
   * One file tab, nested under its workspace's row (spec §4.2 stated
   * spatially: the flat strip has no "nesting", so the sidebar variant
   * anchors the same "after the terminal tabs of the active workspace" rule
   * to that workspace's row instead). `index` is this tab's position in
   * `fileTabs` — the strip's file segment — which `activate` addresses.
   */
  function fileTabRow(view: TabViewModel, index: number) {
    return (
      <div
        key={`file:${view.path}`}
        role="tab"
        aria-selected={view.active}
        tabIndex={0}
        class={`wsitem wsitem--file ${view.active ? "is-active" : ""}`}
        onClick={() => props.fileController.activate(index)}
      >
        <span class="wsitem__text">
          <span
            class={`wsitem__label ${view.preview ? "wsitem__label--preview" : ""}`}
          >
            {view.name}
          </span>
        </span>
        {view.dirty && <span class="wsitem__dot--dirty" aria-hidden="true" />}
        <button
          type="button"
          class="wsitem__close"
          aria-label={`Close ${view.name}`}
          onClick={(event) => {
            event.stopPropagation();
            const workspacePath = activeWorkspace.value;
            if (workspacePath !== null) {
              void props.fileController.closePath(workspacePath, view.path);
            }
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }

  /**
   * `worktree`'s own rows (tab rows, or one readout row when nothing is
   * open), followed by the strip's file segment when this is the workspace
   * `fileTabs` belongs to (spec §4.2). Reused by both the plain and tiered
   * group branches below so the placement rule can't drift between them.
   *
   * Anchored on `worktree.path === activeWorkspace.value`, NOT on any tab's
   * `active` flag: `activeWorkspace` is the one signal that survives a
   * workspace's last terminal tab closing (`file-surface-store.ts`'s own doc
   * comment — the "last surface, not last tab" rule, spec §7), so this is
   * the only anchor that still has a row to attach to in that case (the
   * `worktree.tabs.length === 0` readout branch).
   */
  function worktreeRows(worktree: WorktreeRow, tiered: boolean) {
    const rows =
      worktree.tabs.length === 0
        ? [readoutRow(worktree, tiered)]
        : worktree.tabs.map((tab) => tabRow(worktree, tab, tiered));
    if (worktree.path === "" || worktree.path !== activeWorkspace.value) {
      return rows;
    }
    return [...rows, ...fileTabs.map((view, index) => fileTabRow(view, index))];
  }

  return (
    <nav class="wsbar wsbar--repos" aria-label="Repositories" ref={navRef}>
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
        {/* "Last surface, not last tab" fallback (spec §7) — the active
            workspace's file tabs have no worktree row to nest under (see
            `activeWorkspaceHasRow`'s comment above), so they get their own
            unadorned group rather than vanishing from the rail entirely. */}
        {fileTabs.length > 0 && !activeWorkspaceHasRow && (
          <div class="repogroup repogroup--plain">
            {fileTabs.map((view, index) => fileTabRow(view, index))}
          </div>
        )}
        <button
          type="button"
          class="wsbar__add"
          title={titleWithShortcut("New tab", "new-tab")}
          aria-label="New tab"
          onClick={props.onNewTab}
        >
          <span class="wsbar__add-glyph">
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </span>
          <span>Open workspace</span>
        </button>
      </div>
      {popover.value !== null && popoverTab !== undefined && (
        <TabPopover
          left={popover.value.left}
          top={popover.value.top}
          anchorEl={popover.value.anchorEl}
          name={popoverTab.name}
          dotColor={popoverTab.dotColor}
          hasLogo={
            popoverTab.workspacePath !== null &&
            hasCustomWorkspaceLogo(popoverTab.workspacePath)
          }
          onRename={(name) => {
            const index = resolvePopoverIndex();
            if (index !== -1) {
              props.onRenameTab(index, name);
            }
          }}
          onPickColor={(color) => {
            const index = resolvePopoverIndex();
            if (index !== -1) {
              props.onSetTabColor(index, color);
            }
          }}
          onSetLogo={() => {
            const path = popoverTab.workspacePath;
            popover.value = null;
            if (path !== null) {
              void pickLogoFor(path);
            }
          }}
          onRemoveLogo={() => {
            const path = popoverTab.workspacePath;
            popover.value = null;
            if (path !== null) {
              clearWorkspaceLogo(path);
            }
          }}
          onClose={() => {
            popover.value = null;
          }}
        />
      )}
    </nav>
  );
}
