import type { ComponentChildren } from "preact";
import {
  Columns2,
  Gauge,
  Globe,
  Maximize2,
  MessageSquareText,
  Rows2,
  Settings,
  SquareX,
} from "lucide-preact";
import { ACTION_REGISTRY, type ActionId } from "../../terminal/action-registry";
import { shortcutLabel } from "../../lib/shortcut-label";
import { FeatureToolbar } from "./feature-toolbar";
import type { ToolbarItem, ToolbarItemState } from "./toolbar-item";

/**
 * The shipping projection of the feature toolbar — the piece that turns app
 * state and app callbacks into `ToolbarItem`s and nothing else.
 *
 * Group contents follow the approved plan's D7: `tools` grew Usage when its
 * surface landed with phase 5; Explorer arrives with phase 4's surface.
 * Overflow order is the toolbar spec's: Usage leaves the bar first, then
 * Focus expand, Close pane and the splits; Browser, Prompts and Settings
 * never leave.
 *
 * See docs/specs/2026-08-12-feature-toolbar-design.md and its 2026-08-14
 * Browser amendment (docs/specs/2026-08-13-browser-productization-design.md §5).
 */

const REGISTRY_LABELS: ReadonlyMap<string, string> = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.label]),
);

/**
 * Registry labels are macOS menu grammar — Title Case, with a trailing
 * ellipsis on dialog openers. Chrome copy is sentence case (§8) and the
 * "opens a surface" job belongs to `aria-haspopup` here, so the toolbar layer
 * re-cases at its boundary and the registry keeps the menu's spelling (D6).
 * The transform lowercases every word after the first, which is right for
 * every projected label today; an action whose label carries a proper noun
 * would need its own casing here, not a registry change.
 */
export function toolbarLabel(id: ActionId): string {
  const raw = REGISTRY_LABELS.get(id) ?? id;
  return raw
    .replace(/…$/, "")
    .split(" ")
    .map((word, index) => (index === 0 ? word : word.toLowerCase()))
    .join(" ");
}

const IDLE: ToolbarItemState = { kind: "idle" };
const ACTIVE: ToolbarItemState = { kind: "active" };

interface DeckToolbarProps {
  readonly browserOpen: boolean;
  readonly usageOpen: boolean;
  readonly settingsOpen: boolean;
  readonly expandActive: boolean;
  readonly promptsOpen: boolean;
  /** Why Prompts cannot run right now, or null when it can (spec §3/§4). */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the Prompts control's slot while open. */
  readonly promptPopover?: ComponentChildren;
  readonly updateAction?: ComponentChildren;
  onToggleBrowser(): void;
  onToggleUsage(): void;
  onSplitRow(): void;
  onSplitColumn(): void;
  onToggleExpand(): void;
  onClosePane(): void;
  onTogglePrompts(): void;
  onToggleSettings(): void;
}

export function DeckToolbar(props: DeckToolbarProps) {
  const items: ToolbarItem[] = [
    {
      id: "toggle-browser",
      label: toolbarLabel("toggle-browser"),
      icon: Globe,
      group: "tools",
      shortcut: shortcutLabel("toggle-browser"),
      state: props.browserOpen ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: props.onToggleBrowser,
    },
    {
      id: "toggle-usage",
      label: toolbarLabel("toggle-usage"),
      icon: Gauge,
      group: "tools",
      shortcut: shortcutLabel("toggle-usage"),
      state: props.usageOpen ? ACTIVE : IDLE,
      // The toolbar spec's overflow order: Usage leaves the bar first.
      overflowOrder: 1,
      toggles: "pressed",
      onActivate: props.onToggleUsage,
    },
    {
      id: "split-row",
      label: toolbarLabel("split-row"),
      icon: Columns2,
      group: "pane",
      shortcut: shortcutLabel("split-row"),
      state: IDLE,
      overflowOrder: 5,
      onActivate: props.onSplitRow,
    },
    {
      id: "split-column",
      label: toolbarLabel("split-column"),
      icon: Rows2,
      group: "pane",
      shortcut: shortcutLabel("split-column"),
      state: IDLE,
      overflowOrder: 4,
      onActivate: props.onSplitColumn,
    },
    {
      id: "toggle-expand",
      label: toolbarLabel("toggle-expand"),
      icon: Maximize2,
      group: "pane",
      shortcut: shortcutLabel("toggle-expand"),
      state: props.expandActive ? ACTIVE : IDLE,
      overflowOrder: 2,
      toggles: "pressed",
      onActivate: props.onToggleExpand,
    },
    {
      id: "close-pane",
      label: toolbarLabel("close-pane"),
      icon: SquareX,
      group: "pane",
      shortcut: shortcutLabel("close-pane"),
      state: IDLE,
      overflowOrder: 3,
      onActivate: props.onClosePane,
    },
    {
      id: "toggle-prompts",
      label: toolbarLabel("toggle-prompts"),
      icon: MessageSquareText,
      group: "global",
      shortcut: shortcutLabel("toggle-prompts"),
      state:
        props.promptsUnavailable !== null
          ? { kind: "unavailable", reason: props.promptsUnavailable }
          : props.promptsOpen
            ? ACTIVE
            : IDLE,
      overflowOrder: null,
      toggles: "dialog",
      anchored: props.promptsOpen ? props.promptPopover : undefined,
      onActivate: props.onTogglePrompts,
    },
    {
      id: "toggle-settings",
      label: toolbarLabel("toggle-settings"),
      icon: Settings,
      group: "global",
      shortcut: shortcutLabel("toggle-settings"),
      state: props.settingsOpen ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      controlClass: "iconbtn--gear",
      onActivate: props.onToggleSettings,
    },
  ];

  return <FeatureToolbar items={items} updateAction={props.updateAction} />;
}
