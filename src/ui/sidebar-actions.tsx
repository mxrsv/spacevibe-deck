import { ChatText, ClockCounterClockwise, Gauge, Gear, Globe, TreeView } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { shortcutLabel } from "../lib/shortcut-label";
import type { ActionId } from "../terminal/action-registry";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "./controls/action-tooltip";
import { DeckIcon, RAIL_ICON, type DeckIconComponent } from "./controls/deck-icon";
import { isUnavailable, unavailableReason, type ToolbarItem } from "./toolbar/toolbar-item";
import { toolbarLabel } from "./toolbar/toolbar-label";

/**
 * The rail's tools row (DL §28, restored 2026-10-07 as icons).
 *
 * Every button here is a **shortcut that opens**, and nothing else. It shows no
 * selection state and it never closes what it opened: pressing an already-open
 * surface's icon is a no-op, and putting that surface away is the job of its
 * own close control — the dock's toggle, the browser chip's ✕, a screen's close
 * button, Escape. That is what separates these icons from the toolbar and from
 * the dock's tab row, both of which DO report state (DL-28.5, DL-21.8).
 *
 * Icons, not rows: the rail's own rows now carry a task label and a status
 * line, so the foot reads as chrome beside them. The name and the chord live in
 * a DL-23 tooltip that opens **above** the button (DL-23.4), since the row
 * stands in the window's bottom edge. Top-tab mode and Tauri have no rail —
 * `DeckToolbar` stands the global group up in `More` there.
 *
 * State-free in the strongest sense: the only flag it takes is whether Prompts
 * can run at all, which is availability, not selection.
 */
export interface SidebarActionsProps {
  /** False on a host with no `sessions_list`; the icon is then not built. */
  readonly sessionsAvailable: boolean;
  /** Why Prompts cannot run right now, or null when it can. */
  readonly promptsUnavailable: string | null;
  /** Rendered inside the row's slot while the popover is open. */
  readonly promptPopover?: ComponentChildren;
  /** Only so the popover mounts in this row's slot — never painted as state. */
  readonly promptsOpen: boolean;
  onOpenSessions(): void;
  onOpenUsage(): void;
  onOpenExplorer(): void;
  onOpenPrompts(): void;
  onOpenBrowser(): void;
  onOpenSettings(): void;
}

function toolItem(
  id: ActionId,
  icon: DeckIconComponent,
  onActivate: () => void,
  extra: Partial<ToolbarItem> = {},
): ToolbarItem {
  return {
    id,
    label: toolbarLabel(id),
    icon,
    group: "tools",
    shortcut: shortcutLabel(id),
    state: { kind: "idle" },
    overflowOrder: null,
    onActivate,
    ...extra,
  };
}

/**
 * The tools in the owner's order (DL-28.3). Label and chord come from the
 * registry through the same helpers `More` uses, so the row, the collapsed
 * menu and the toolbar cannot say different things. Session history is omitted
 * entirely on a host that cannot answer `sessions_list`, the precedent the
 * dock's tab row follows (DL-19.7): an icon that opens an empty surface is
 * worse than none.
 */
export function railToolItems(props: SidebarActionsProps): readonly ToolbarItem[] {
  const prompts = toolItem("toggle-prompts", ChatText, props.onOpenPrompts, {
    // DL-23.6: unavailable is not disabled — the control keeps its place in the
    // tab order, reads faint and carries the reason, which the tooltip prints.
    state:
      props.promptsUnavailable === null
        ? { kind: "idle" }
        : { kind: "unavailable", reason: props.promptsUnavailable },
    // `aria-haspopup` without `aria-expanded`: it opens the popover but never
    // reports or reverses its state, so claiming to be expanded would promise a
    // control it does not offer.
    toggles: "dialog",
  });
  return [
    ...(props.sessionsAvailable
      ? [toolItem("toggle-sessions", ClockCounterClockwise, props.onOpenSessions)]
      : []),
    toolItem("toggle-usage", Gauge, props.onOpenUsage),
    toolItem("toggle-explorer", TreeView, props.onOpenExplorer),
    prompts,
    toolItem("toggle-browser", Globe, props.onOpenBrowser),
    toolItem("toggle-settings", Gear, props.onOpenSettings),
  ];
}

interface ToolButtonProps {
  readonly item: ToolbarItem;
  /** The Prompt Board popover flies up from the row, over where any tooltip would open. */
  readonly tooltipSuppressed: boolean;
}

/** One icon and its tooltip — a component because the tooltip is a hook per control. */
function ToolButton({ item, tooltipSuppressed }: ToolButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility("above");
  const reason = unavailableReason(item);
  const tooltipId = `rail-tool-tip-${item.id}`;
  const showTooltip = tooltip.anchor !== null && !tooltipSuppressed;

  return (
    <>
      <button
        ref={ref}
        type="button"
        class={`iconbtn sidebar-actions__tool ${reason !== null ? "is-unavailable" : ""}`}
        aria-label={item.label}
        aria-haspopup={item.toggles === "dialog" ? "dialog" : undefined}
        aria-disabled={reason !== null ? true : undefined}
        aria-describedby={showTooltip ? tooltipId : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={() => {
          if (isUnavailable(item)) {
            return;
          }
          item.onActivate();
        }}
      >
        <DeckIcon icon={item.icon} size={RAIL_ICON} />
      </button>
      {showTooltip && tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={item.label}
          shortcut={item.shortcut}
          reason={reason}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

export function SidebarActions(props: SidebarActionsProps) {
  return (
    <nav class="sidebar-actions" aria-label="Tools">
      {/* The positioning context for the Prompt Board popover, which opens from
          the row rather than from a toolbar slot in this layout. */}
      <div class="sidebar-actions__slot">
        <div class="sidebar-actions__tools">
          {railToolItems(props).map((item) => (
            <ToolButton
              key={item.id}
              item={item}
              tooltipSuppressed={props.promptsOpen}
            />
          ))}
        </div>
        {props.promptsOpen ? props.promptPopover : null}
      </div>
    </nav>
  );
}
