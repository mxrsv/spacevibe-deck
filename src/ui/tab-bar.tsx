import { Plus, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import {
  activeTabIndex,
  IDLE_ATTENTION_SUMMARY,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
import { dotColor } from "../lib/process-info";
import { tabDotCssColor, type TabDotColor } from "../lib/tab-colors";
import { AgentAttentionMark } from "./agent-attention-mark";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { tabPopoverOpen } from "../chrome/events";
import { TabPopover } from "./tab-popover";
import { titleWithShortcut } from "../lib/shortcut-label";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { activeWorkspace } from "../files/file-surface-store";
import { fileTabViews } from "../files/file-tab-views";

interface TabBarProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  /**
   * The feature toolbar, built once by `App` so this mount and the sidebar
   * frame's mount can never drift apart (one element, both layouts). TabBar
   * places it; it does not know what is in it.
   */
  toolbar: ComponentChildren;
  /** Invoked when a tab's actionable attention mark is clicked. */
  onFocusAttention?(index: number): void;
  /**
   * The same `SurfaceStrip` wired into `TabManager` (Task 5) — read here
   * only for `fileTabViews`'s projection and the `activate`/`closePath`
   * calls its own chips need. TabBar never learns what a file IS, only
   * what this projects (spec §2.3's seam, extended to the renderer).
   */
  fileController: FileSurfaceController;
}

export function TabBar(props: TabBarProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  // A file surface can hold the stage while `active` still names whichever
  // terminal tab it sits on top of (selecting a file never touches
  // `TabManager`'s own `active` index) — so a terminal chip is only the
  // VISIBLE active tab when neither is true.
  const fileTabs = fileTabViews(props.fileController);
  const surfaceActive = props.fileController.activeIndex() >= 0;
  const rootRef = useRef<HTMLElement>(null);
  // Anchored by tab key, not index — tabs can close (and indexes shift)
  // while the popover is open; actions resolve the index at call time.
  const popover = useSignal<{
    key: number;
    left: number;
    top: number;
    anchorEl: HTMLElement;
  } | null>(null);

  // Mirror the popover's open state into the shared signal — the browser
  // panel's native view has to be hidden while anything floats over the stage,
  // and it cannot see a component-local signal.
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

  function openPopover(key: number, anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    popover.value = { key, left: rect.left, top: rect.bottom + 6, anchorEl };
  }

  // The open-tab-options shortcut doesn't know whether TabBar or WorkspaceSidebar is
  // mounted, so it goes through this shared signal instead — see its doc
  // comment in tabs-store.ts. Unknown/not-yet-rendered key (tab closed
  // between the request and this effect, or a stale key) → no anchor found,
  // safe no-op; the signal still resets so a later request isn't swallowed.
  useSignalEffect(() => {
    const key = requestTabOptionsKey.value;
    if (key === null) {
      return;
    }
    const anchorEl = rootRef.current?.querySelector<HTMLElement>(
      `[data-key="${key}"]`,
    );
    if (anchorEl) {
      openPopover(key, anchorEl);
    }
    requestTabOptionsKey.value = null;
  });

  return (
    <header class="tabbar" data-tauri-drag-region ref={rootRef}>
      {/* DL-18: in top-tab mode this row IS the window frame, so it reserves
          the traffic-light inset itself rather than sitting under an empty
          titlebar. Always in the tree; `--frame-lights-w` defaults to the
          macOS footprint and only `.window--windows` zeroes it and hides the
          element outright, so the `"unsupported"` platform fallback (see
          platform.ts) also reserves that width, not just macOS
          (DL-18.5 — nothing is reserved where no OS paints). */}
      <div class="deck-frame__lights" aria-hidden="true" />
      <div class="tabbar__tabs" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.key}
            role="tab"
            aria-selected={index === active && !surfaceActive}
            tabIndex={0}
            data-key={tab.key}
            class={`tab ${index === active && !surfaceActive ? "is-active" : ""}`}
            onClick={(event) => {
              // A file surface sitting on top of THIS same index still
              // needs the click to take the stage back — `index === active`
              // alone would open the rename popover instead (spec §7,
              // "selecting a terminal tab takes the stage back").
              if (index !== active || surfaceActive) {
                props.onSelectTab(index);
                return;
              }
              if (popover.value?.key === tab.key) {
                popover.value = null; // second click on the active tab toggles it off
                return;
              }
              openPopover(tab.key, event.currentTarget as HTMLElement);
            }}
          >
            <span
              class="tab__dot"
              style={{
                background: tab.dotColor
                  ? tabDotCssColor(tab.dotColor)
                  : dotColor(tab.process),
              }}
            />
            <span class="tab__label">{tab.name ?? tab.process ?? "shell"}</span>
            {/* Only mount when the mark actually renders something — an
                idle summary renders null, and an unconditional wrapper
                would still consume a flex `gap` gutter on every idle tab. */}
            {(tab.attention ?? IDLE_ATTENTION_SUMMARY).kind !== "idle" && (
              // stopPropagation keeps a click on the mark from bubbling to
              // the tab's own onClick (select tab / toggle popover).
              <span
                class="tab__attn"
                onClick={(event) => event.stopPropagation()}
              >
                <AgentAttentionMark
                  summary={tab.attention ?? IDLE_ATTENTION_SUMMARY}
                  label={tab.name ?? tab.process ?? "shell"}
                  onActivate={
                    props.onFocusAttention
                      ? () => props.onFocusAttention!(index)
                      : undefined
                  }
                />
              </span>
            )}
            <button
              type="button"
              class="tab__close"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                props.onCloseTab(index);
              }}
            >
              <DeckIcon icon={X} size={CHROME_ICON} />
            </button>
          </div>
        ))}
        {/* File tabs of the active surface's workspace, after every terminal
            tab (spec §4.2) — the strip's file segment, driven by the same
            controller wired as TabManager's SurfaceStrip (Task 5). */}
        {fileTabs.length > 0 && <span class="tabbar__sep" aria-hidden="true" />}
        {fileTabs.map((tab, index) => (
          <div
            key={tab.path}
            role="tab"
            aria-selected={tab.active}
            tabIndex={0}
            class={`tab tab--file ${tab.active ? "is-active" : ""}`}
            onClick={() => props.fileController.activate(index)}
          >
            <span
              class={`tab__label ${tab.preview ? "tab__label--preview" : ""}`}
            >
              {tab.name}
            </span>
            {tab.dirty && (
              <span class="tab__dot tab__dot--dirty" aria-hidden="true" />
            )}
            <button
              type="button"
              class="tab__close"
              aria-label={`Close ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation();
                const workspacePath = activeWorkspace.value;
                if (workspacePath !== null) {
                  void props.fileController.closePath(workspacePath, tab.path);
                }
              }}
            >
              <DeckIcon icon={X} size={CHROME_ICON} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        class="tab-add"
        title={titleWithShortcut("New tab", "new-tab")}
        aria-label="New tab"
        onClick={props.onNewTab}
      >
        <DeckIcon icon={Plus} size={CHROME_ICON} />
      </button>
      <div class="tabbar__spacer" data-tauri-drag-region />
      {props.toolbar}
      {popover.value !== null && popoverTab !== undefined && (
        <TabPopover
          left={popover.value.left}
          top={popover.value.top}
          anchorEl={popover.value.anchorEl}
          name={popoverTab.name}
          dotColor={popoverTab.dotColor}
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
          onClose={() => {
            popover.value = null;
          }}
        />
      )}
    </header>
  );
}
