import {
  ArrowsOut,
  ChatText,
  Gear,
  Globe,
  SquareSplitHorizontal,
  SquareSplitVertical,
  XSquare,
} from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { ACTION_REGISTRY, type ActionId } from "../../terminal/action-registry";
import { shortcutLabel } from "../../lib/shortcut-label";
import { FeatureToolbar } from "./feature-toolbar";
import type { ToolbarItem, ToolbarItemState } from "./toolbar-item";

/**
 * The shipping projection of the feature toolbar — the piece that turns app
 * state and app callbacks into `ToolbarItem`s and nothing else.
 *
 * Group contents shrank twice on 2026-08-16. First File explorer, Token usage
 * and Session history left the bar for the docked side panel, which carries
 * its own tab row and its own toggle on the stage strip — putting a second way
 * in on the toolbar would be three controls that say what one tab row already
 * says. Then the pane group itself moved off the bar and into `More`
 * (DL-23.8), so the projection now emits no bar items at all: the toolbar is
 * the `More` control, and every action it offers is a named row with its
 * chord. Overflow by width is left wired but idle — there is nothing on the
 * bar for a narrow window to push off.
 *
 * The toolbar's rules — tooltips, the overflow menu, the `More` control — are
 * `docs/DESIGN-LANGUAGE.md` §23. The 2026-08-14 Browser amendment made the
 * browser's toolbar action a toggle of the browser tab rather than a docked
 * column.
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

/**
 * The toolbar's `Overview` button is HIDDEN for now (owner, 2026-10-04).
 * Mission Control itself stays: ⌘⇧O and View ▸ Mission Control still open it
 * (DL-35.1). `App` reads this flag and passes no `missionControl`, so the
 * component and its tests stand — restoring the button is flipping this one
 * constant, the revert seam the rail's old hidden-tools flag established.
 */
export const MISSION_CONTROL_BUTTON_HIDDEN = true;

const IDLE: ToolbarItemState = { kind: "idle" };
const ACTIVE: ToolbarItemState = { kind: "active" };

interface DeckToolbarProps {
  /**
   * Mission Control's entry on the bar (DL-35.1), in the place and treatment
   * the Agent Board's one button had (DL-34.1's view control) — the overview
   * you step into and back out of. It toggles either way, as ⌘⇧O does.
   */
  readonly missionControl?: {
    readonly open: boolean;
    onToggle(): void;
  };
  /**
   * Top-tab mode. The global group then rides in the `More` menu instead of
   * the bar: the sidebar carries it in the rail's own tools row, and this
   * layout has no rail, so one menu stands in for that row.
   */
  readonly compact?: boolean;
  /**
   * The rail's tools row is on screen (DL-28, restored 2026-10-07): Electron's
   * sidebar with a live rail. `More` then carries the pane group only, and the
   * Prompt Board popover anchors to the rail instead (DL-23.8). Absent on Tauri
   * and with no live rail, where nothing else holds the global group.
   */
  readonly railToolsMounted?: boolean;
  /** The browser surface holds the stage — the chip may be open without it. */
  readonly browserActive: boolean;
  readonly settingsOpen: boolean;
  readonly expandActive: boolean;
  readonly promptsOpen: boolean;
  /** Why Prompts cannot run right now, or null when it can (spec §3/§4). */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the Prompts control's slot while open. */
  readonly promptPopover?: ComponentChildren;
  readonly updateAction?: ComponentChildren;
  /**
   * The external-app split-button (new DL-23.11), built by `App` because it
   * needs the installed-app scan and the active workspace. Projected in as a
   * node rather than as state: it is the one control on this bar that owns its
   * own icon and its own menu, so `ToolbarItem` cannot describe it.
   */
  readonly externalApp?: ComponentChildren;
  /**
   * The needs-you chip (DL-27.26, amended 2026-10-06), built by `App` because
   * the focus it triggers runs the app's attention preflight. Projected in as a
   * node, like `externalApp`: it owns its own count, colour and popover.
   */
  readonly attention?: ComponentChildren;
  onToggleBrowser(): void;
  onSplitRow(): void;
  onSplitColumn(): void;
  onToggleExpand(): void;
  onClosePane(): void;
  onTogglePrompts(): void;
  onToggleSettings(): void;
}

export function DeckToolbar(props: DeckToolbarProps) {
  /**
   * `overflowOrder` is `null` on every one of these since 2026-08-16: they no
   * longer sit on the bar, so nothing can push them off it. The priority the
   * numbers used to encode is the render order below, which is what the menu
   * prints (DL-23.8).
   */
  const paneItems: ToolbarItem[] = [
    {
      id: "split-row",
      label: toolbarLabel("split-row"),
      icon: SquareSplitHorizontal,
      group: "pane",
      shortcut: shortcutLabel("split-row"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onSplitRow,
    },
    {
      id: "split-column",
      label: toolbarLabel("split-column"),
      icon: SquareSplitVertical,
      group: "pane",
      shortcut: shortcutLabel("split-column"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onSplitColumn,
    },
    {
      id: "toggle-expand",
      label: toolbarLabel("toggle-expand"),
      icon: ArrowsOut,
      group: "pane",
      shortcut: shortcutLabel("toggle-expand"),
      state: props.expandActive ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: props.onToggleExpand,
    },
    {
      id: "close-pane",
      label: toolbarLabel("close-pane"),
      icon: XSquare,
      group: "pane",
      shortcut: shortcutLabel("close-pane"),
      state: IDLE,
      overflowOrder: null,
      onActivate: props.onClosePane,
    },
  ];

  // Where the global group stands: in the rail's tools row when one is mounted,
  // in `More` otherwise — which is also the only anchor the Prompt Board
  // popover then has, so exactly one of the two ever renders it.
  const globalInMore = props.compact === true || props.railToolsMounted !== true;

  const globalItems: ToolbarItem[] = [
    {
      id: "toggle-browser",
      label: toolbarLabel("toggle-browser"),
      icon: Globe,
      group: "global",
      shortcut: shortcutLabel("toggle-browser"),
      state: props.browserActive ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      onActivate: props.onToggleBrowser,
    },
    {
      id: "toggle-prompts",
      label: toolbarLabel("toggle-prompts"),
      icon: ChatText,
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
      icon: Gear,
      group: "global",
      shortcut: shortcutLabel("toggle-settings"),
      state: props.settingsOpen ? ACTIVE : IDLE,
      overflowOrder: null,
      toggles: "pressed",
      controlClass: "iconbtn--gear",
      onActivate: props.onToggleSettings,
    },
  ];

  return (
    <>
      {props.missionControl ? (
        <div class="agent-view-switch" role="group" aria-label="Agent view">
          {/* One item. A press fires even while pressed: it is the way out of
              Mission Control as well as the way in. */}
          <button
            type="button"
            class={`tab agent-view-switch__tab ${props.missionControl.open ? "is-active" : ""}`}
            aria-pressed={props.missionControl.open}
            title="Mission Control"
            onClick={() => props.missionControl?.onToggle()}
          >
            Overview
          </button>
        </div>
      ) : null}
      <FeatureToolbar
        // Nothing is drawn as an icon on the bar any more (DL-23.8): the pane
        // group lives in `More`, and the global group never rode here in the
        // first place — the Electron sidebar shows it as the rail's icon row
        // (DL-28.3) and top-tab mode and Tauri stand the same rows up in
        // `More`, which is what keeps a second Prompt Board popover off the
        // screen.
        items={[]}
        externalApp={props.externalApp}
        attention={props.attention}
        updateAction={props.updateAction}
        pinnedMenu={globalInMore ? [...paneItems, ...globalItems] : paneItems}
        // Only while the popover's own row lives in the menu; with the rail's
        // tools mounted, its row or collapsed button is the anchor instead.
        pinnedMenuAnchored={globalInMore && props.promptsOpen ? props.promptPopover : undefined}
      />
    </>
  );
}
