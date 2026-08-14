import { Plus, X } from "lucide-preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "../host/dialog-host";
import type { UnlistenFn } from "../host/bridge";
import {
  activeTabIndex,
  IDLE_ATTENTION_SUMMARY,
  requestTabOptionsKey,
  statusInfo,
  tabViews,
} from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { tildify } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import { type TabDotColor } from "../lib/tab-colors";
import { installFileDrop } from "../terminal/file-drop";
import {
  clearWorkspaceLogo,
  ensureFaviconScanned,
  hasCustomWorkspaceLogo,
  setWorkspaceLogoFromPath,
} from "../settings/workspace-logo-store";
import { pickImagePath } from "../settings/logo-store";
import { reportPersistError } from "../chrome/events";
import { TabPopover } from "./tab-popover";
import { useTabPopoverSlot } from "./tab-popover-slot";
import { WorkspaceLogo } from "./workspace-logo";

interface WorkspaceSidebarProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  /** Footer "Open workspace" row: the Open board's full flow (kept in sync with RepositoryRail's same-named prop for the one-line revert). */
  onOpenWorkspace(): void;
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  /** Invoked when a row's actionable attention mark is clicked. */
  onFocusAttention?(index: number): void;
}

/** Vertical workspace list: one row per tab, with a per-workspace logo. */
export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const home = statusInfo.value.home;
  const navRef = useRef<HTMLElement>(null);
  const dragOverKey = useSignal<number | null>(null);
  // Anchored by tab key, not index — same reason as the horizontal tab bar:
  // tabs can close (and indexes shift) while the popover is open.
  const popover = useSignal<{
    key: number;
    left: number;
    top: number;
    anchorEl: HTMLElement;
  } | null>(null);

  // Mirror the popover's open state into the shared signal — the browser
  // panel's native view has to be hidden while anything floats over the stage,
  // and it cannot see a component-local signal.
  useTabPopoverSlot("sidebar", popover);

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

  // Drop an image onto a workspace row → that workspace's custom logo.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    function rowPathAt(x: number, y: number): string | null {
      const row = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>(".wsitem");
      return row?.dataset.workspace || null;
    }
    function keyAt(x: number, y: number): number | null {
      const row = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>(".wsitem");
      const key = row?.dataset.key;
      return key === undefined ? null : Number(key);
    }

    installFileDrop({
      onOver(x, y) {
        dragOverKey.value = keyAt(x, y);
      },
      onLeave() {
        dragOverKey.value = null;
      },
      onDrop(x, y, paths) {
        dragOverKey.value = null;
        const workspacePath = rowPathAt(x, y);
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

  // The open-tab-options shortcut doesn't know whether TabBar or WorkspaceSidebar is
  // mounted, so it goes through this shared signal instead — see its doc
  // comment in tabs-store.ts. Unknown/not-yet-rendered key → no anchor found,
  // safe no-op; the signal still resets so a later request isn't swallowed.
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

  return (
    <nav class="wsbar" aria-label="Workspaces" ref={navRef}>
      <div class="wsbar__list" role="tablist" aria-label="Workspace tabs">
        {tabs.map((tab, index) => {
          const label =
            tab.name ??
            (tab.workspacePath === null
              ? "Unknown"
              : workspaceLabel(tab.workspacePath));
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={index === active}
              tabIndex={0}
              data-key={tab.key}
              data-workspace={tab.workspacePath ?? ""}
              class={`wsitem ${index === active ? "is-active" : ""} ${dragOverKey.value === tab.key ? "is-drag-over" : ""}`}
              onClick={(event) => {
                if (index !== active) {
                  props.onSelectTab(index);
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
                attention={tab.attention ?? IDLE_ATTENTION_SUMMARY}
                onFocusAttention={
                  props.onFocusAttention
                    ? () => props.onFocusAttention!(index)
                    : undefined
                }
              />
              <span class="wsitem__text">
                <span class="wsitem__label">{label}</span>
                {tab.workspacePath !== null && (
                  <span class="wsitem__path">
                    {/* U+200E keeps the path LTR inside the RTL (head-ellipsis)
                        container — without it the leading "~" flips to the end. */}
                    {`‎${tildify(tab.workspacePath, home)}`}
                  </span>
                )}
              </span>
              <button
                type="button"
                class="wsitem__close"
                aria-label="Close workspace"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseTab(index);
                }}
              >
                <DeckIcon icon={X} size={CHROME_ICON} />
              </button>
            </div>
          );
        })}
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
