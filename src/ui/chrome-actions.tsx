import type { ComponentChildren } from "preact";
import {
  ChartColumn,
  Columns2,
  Maximize2,
  MessageSquareText,
  Rows2,
  Settings,
  SquareX,
} from "lucide-preact";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
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
  /** Whether the token usage screen is up (drives `aria-pressed`). */
  usageOpen: boolean;
  updateAction?: ComponentChildren;
  onSplitRow(): void;
  onSplitColumn(): void;
  onClosePane(): void;
  onToggleExpand(): void;
  onTogglePrompts(): void;
  onToggleUsage(): void;
  onToggleSettings(): void;
}

/** Pane + settings actions — lives in the tab bar (top) or the titlebar (left). */
export function ChromeActions(props: ChromeActionsProps) {
  const splitRow = shortcutLabel("split-row");
  const splitColumn = shortcutLabel("split-column");
  const closePane = shortcutLabel("close-pane");
  const toggleExpand = shortcutLabel("toggle-expand");
  const prompts = shortcutLabel("toggle-prompts");
  const usage = shortcutLabel("toggle-usage");
  const settings = shortcutLabel("toggle-settings");
  return (
    <div class="tabbar__actions">
      <button
        type="button"
        class="iconbtn"
        title={`Split vertically (${splitRow})`}
        aria-label="Split pane vertically"
        onClick={props.onSplitRow}
      >
        <DeckIcon icon={Columns2} size={CHROME_ICON} />
      </button>
      <button
        type="button"
        class="iconbtn"
        title={`Split horizontally (${splitColumn})`}
        aria-label="Split pane horizontally"
        onClick={props.onSplitColumn}
      >
        <DeckIcon icon={Rows2} size={CHROME_ICON} />
      </button>
      <button
        type="button"
        class="iconbtn"
        title={`Close pane (${closePane})`}
        aria-label="Close current pane"
        onClick={props.onClosePane}
      >
        <DeckIcon icon={SquareX} size={CHROME_ICON} />
      </button>
      <button
        type="button"
        class={`iconbtn ${props.expandActive ? "is-active" : ""}`}
        title={`Focus expand (${toggleExpand})`}
        aria-label="Toggle focus expand"
        aria-pressed={props.expandActive}
        onClick={props.onToggleExpand}
      >
        <DeckIcon icon={Maximize2} size={CHROME_ICON} />
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
          <DeckIcon icon={MessageSquareText} size={CHROME_ICON} />
        </button>
        {props.promptsOpen ? props.promptPopover : null}
      </span>
      <span class="tabbar__sep" aria-hidden="true" />
      {props.updateAction}
      {/* App-level, like the gear beside it — that is why it sits AFTER the
          separator rather than next to Prompts, which is pane-scoped. It is
          still "between Prompts and Settings" as the spec requires.
          `aria-pressed`, not `aria-expanded`: this opens a screen, not a
          popover, so it matches the gear's contract, not the Prompt Board's. */}
      <button
        type="button"
        class={`iconbtn ${props.usageOpen ? "is-active" : ""}`}
        title={`Token usage (${usage})`}
        aria-label="Open token usage"
        aria-pressed={props.usageOpen}
        onClick={props.onToggleUsage}
      >
        <DeckIcon icon={ChartColumn} size={CHROME_ICON} />
      </button>
      <button
        type="button"
        class={`iconbtn iconbtn--gear ${props.settingsOpen ? "is-active" : ""}`}
        title={`Settings (${settings})`}
        aria-label="Open settings"
        aria-pressed={props.settingsOpen}
        onClick={props.onToggleSettings}
      >
        <DeckIcon icon={Settings} size={CHROME_ICON} />
      </button>
    </div>
  );
}
