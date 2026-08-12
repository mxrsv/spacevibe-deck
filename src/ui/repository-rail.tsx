import { ChevronDown, ChevronRight, FolderGit2, Plus, RefreshCw, X } from "lucide-preact";
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
    return (
      <div
        key={tab.key}
        role="tab"
        aria-selected={tab.active}
        tabIndex={0}
        data-key={tab.key}
        data-workspace={tab.workspacePath ?? ""}
        data-state={worktree.state}
        class={`wsitem ${tab.active ? "is-active" : ""} ${dragOverKey.value === tab.key ? "is-drag-over" : ""}`}
        onClick={(event) => {
          if (!tab.active) {
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

  return (
    <nav class="wsbar wsbar--repos" aria-label="Repositories" ref={navRef}>
      <div class="wsbar__list" role="tablist" aria-label="Workspace tabs">
        {groups.map((group) =>
          // A folder that is not a repository does not sprout a repository
          // tier. It renders as the bare row Deck has always shown — the rail
          // adds a tier where git says there is one, and nowhere else.
          group.kind === "plain" ? (
            <div key={group.key} class="repogroup repogroup--plain">
              {group.worktrees.map((worktree) =>
                worktree.tabs.length === 0
                  ? readoutRow(worktree, false)
                  : worktree.tabs.map((tab) => tabRow(worktree, tab, false)),
              )}
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
                  worktree.tabs.length === 0
                    ? readoutRow(worktree, true)
                    : worktree.tabs.map((tab) => tabRow(worktree, tab, true)),
                )}
              </div>
            )}
          </section>
          ),
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
