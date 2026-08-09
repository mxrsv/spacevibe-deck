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
import { ChromeActions } from "./chrome-actions";
import { TabPopover } from "./tab-popover";
import { shortcutLabel } from "../lib/shortcut-label";

interface TabBarProps {
  settingsOpen: boolean;
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  onSplitRow(): void;
  onSplitColumn(): void;
  onClosePane(): void;
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  onToggleSettings(): void;
  expandActive: boolean;
  /** Whether the Prompt Board popover is up — forwarded to ChromeActions. */
  promptsOpen: boolean;
  promptsDisabled: boolean;
  promptPopover?: ComponentChildren;
  onTogglePrompts(): void;
  updateAction?: ComponentChildren;
  onToggleExpand(): void;
  /** Invoked when a tab's actionable attention mark is clicked. */
  onFocusAttention?(index: number): void;
}

export function TabBar(props: TabBarProps) {
  const tabs = tabViews.value;
  const active = activeTabIndex.value;
  const rootRef = useRef<HTMLElement>(null);
  // Anchored by tab key, not index — tabs can close (and indexes shift)
  // while the popover is open; actions resolve the index at call time.
  const popover = useSignal<{
    key: number;
    left: number;
    top: number;
    anchorEl: HTMLElement;
  } | null>(null);
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
      <div class="tabbar__tabs" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.key}
            role="tab"
            aria-selected={index === active}
            tabIndex={0}
            data-key={tab.key}
            class={`tab ${index === active ? "is-active" : ""}`}
            onClick={(event) => {
              if (index !== active) {
                props.onSelectTab(index); // inactive tab: just select
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
      </div>
      <button
        type="button"
        class="tab-add"
        title={`New tab (${shortcutLabel("new-tab")})`}
        aria-label="New tab"
        onClick={props.onNewTab}
      >
        <DeckIcon icon={Plus} size={CHROME_ICON} />
      </button>
      <div class="tabbar__spacer" data-tauri-drag-region />
      <ChromeActions
        settingsOpen={props.settingsOpen}
        expandActive={props.expandActive}
        onSplitRow={props.onSplitRow}
        onSplitColumn={props.onSplitColumn}
        onClosePane={props.onClosePane}
        onToggleExpand={props.onToggleExpand}
        promptsOpen={props.promptsOpen}
        promptsDisabled={props.promptsDisabled}
        promptPopover={props.promptPopover}
        onTogglePrompts={props.onTogglePrompts}
        onToggleSettings={props.onToggleSettings}
        updateAction={props.updateAction}
      />
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
