import type { ComponentChildren } from "preact";
import { shortcutLabel } from "../lib/shortcut-label";

interface ChromeActionsProps {
  settingsOpen: boolean;
  expandActive: boolean;
  /** Whether the Prompt Board popover is up (drives `aria-expanded`). */
  promptsOpen: boolean;
  /** No pane to paste into, or an overlay is covering the one there is. */
  promptsDisabled: boolean;
  /** Rendered inside the trigger's anchor while open — see `.prompts-anchor`. */
  promptPopover?: ComponentChildren;
  updateAction?: ComponentChildren;
  onSplitRow(alacritty: boolean): void;
  onSplitColumn(alacritty: boolean): void;
  onClosePane(): void;
  onToggleExpand(): void;
  onTogglePrompts(): void;
  onToggleSettings(): void;
}

function SplitRowIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <line x1="12" y1="4.5" x2="12" y2="19.5" />
    </svg>
  );
}

function SplitColumnIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
    </svg>
  );
}

function ClosePaneIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 9.5l5 5m0-5l-5 5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v3" />
      <path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v3" />
      <path d="M9 19.5H6A1.5 1.5 0 0 1 4.5 18v-3" />
      <path d="M15 19.5h3a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </svg>
  );
}

function PromptsIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
      <path d="M9 12h6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  );
}

/** Pane + settings actions — lives in the tab bar (top) or the titlebar (left). */
export function ChromeActions(props: ChromeActionsProps) {
  const splitRow = shortcutLabel("split-row");
  const splitColumn = shortcutLabel("split-column");
  const closePane = shortcutLabel("close-pane");
  const toggleExpand = shortcutLabel("toggle-expand");
  const prompts = shortcutLabel("toggle-prompts");
  const settings = shortcutLabel("toggle-settings");
  return (
    <div class="tabbar__actions">
      <button
        type="button"
        class="iconbtn"
        title={`Split vertically (${splitRow}); hold Shift for Alacritty`}
        aria-label="Split pane vertically"
        onClick={(event) => props.onSplitRow(event.shiftKey)}
      >
        <SplitRowIcon />
      </button>
      <button
        type="button"
        class="iconbtn"
        title={`Split horizontally (${splitColumn}); hold Shift for Alacritty`}
        aria-label="Split pane horizontally"
        onClick={(event) => props.onSplitColumn(event.shiftKey)}
      >
        <SplitColumnIcon />
      </button>
      <button
        type="button"
        class="iconbtn"
        title={`Close pane (${closePane})`}
        aria-label="Close current pane"
        onClick={props.onClosePane}
      >
        <ClosePaneIcon />
      </button>
      <button
        type="button"
        class={`iconbtn ${props.expandActive ? "is-active" : ""}`}
        title={`Focus expand (${toggleExpand})`}
        aria-label="Toggle focus expand"
        aria-pressed={props.expandActive}
        onClick={props.onToggleExpand}
      >
        <ExpandIcon />
      </button>
      <span class="prompts-anchor">
        <button
          type="button"
          class={`iconbtn ${props.promptsOpen ? "is-active" : ""}`}
          title={`Prompts (${prompts})`}
          aria-label="Open the prompt board"
          aria-haspopup="dialog"
          aria-expanded={props.promptsOpen}
          disabled={props.promptsDisabled}
          onClick={props.onTogglePrompts}
        >
          <PromptsIcon />
        </button>
        {props.promptsOpen ? props.promptPopover : null}
      </span>
      <span class="tabbar__sep" aria-hidden="true" />
      {props.updateAction}
      <button
        type="button"
        class={`iconbtn iconbtn--gear ${props.settingsOpen ? "is-active" : ""}`}
        title={`Settings (${settings})`}
        aria-label="Open settings"
        aria-pressed={props.settingsOpen}
        onClick={props.onToggleSettings}
      >
        <GearIcon />
      </button>
    </div>
  );
}
