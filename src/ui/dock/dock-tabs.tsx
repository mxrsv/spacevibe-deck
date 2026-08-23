import { useRef } from "preact/hooks";
import { shortcutLabel } from "../../lib/shortcut-label";
import {
  ActionTooltip,
  useTooltipVisibility,
  tooltipTriggerProps,
} from "../controls/action-tooltip";
import { FEATURE_ICON, DeckIcon } from "../controls/deck-icon";
import type { DockTabDescriptor, DockTabId } from "./dock-tab-registry";

interface DockTabsProps {
  readonly items: readonly DockTabDescriptor[];
  readonly active: DockTabId;
  onSelect(id: DockTabId): void;
}

interface DockTabChipProps {
  readonly item: DockTabDescriptor;
  readonly active: boolean;
  onSelect(id: DockTabId): void;
}

/**
 * One chip and its tooltip.
 *
 * A component rather than a body inside `DockTabs`' `.map()`, because
 * `useTooltipVisibility` is a hook and a hook cannot be called per iteration.
 * The shape is `ToolbarControl`'s (`toolbar/feature-toolbar.tsx`) with the
 * unavailable branch left out — a tab in this list is always runnable, since
 * `availableDockTabs` OMITS a surface the host cannot answer rather than
 * showing it inert (DL-19.7).
 *
 * The native `title` that used to carry the name is deliberately gone: two
 * tooltips for one control is one too many, and this one is the tooltip
 * DL-23.1 describes — name, chord, nothing else. The accessible name stays on
 * `aria-label`, and `aria-describedby` points at the tooltip while it shows.
 */
function DockTabChip({ item, active, onSelect }: DockTabChipProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const tooltipId = `dock-tab-tip-${item.id}`;

  return (
    <>
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={item.label}
        aria-describedby={tooltip.anchor !== null ? tooltipId : undefined}
        class={`iconbtn dock-tabs__chip ${active ? "is-active" : ""}`}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={() => onSelect(item.id)}
      >
        <DeckIcon icon={item.icon} size={FEATURE_ICON} filled />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={item.label}
          shortcut={shortcutLabel(item.action)}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

/**
 * The docked panel's own tab row — switches which of the panel's surfaces
 * (explorer / usage / sessions) is showing. A `role="tablist"` of `role="tab"`
 * icon-only chips beside the panel toggle; the active chip carries DL-21.1's
 * full `--tab-active-bg` wash, idle chips carry none, and hover is the quieter
 * DL-21.2 wash. Each chip keeps its full accessible name, and says that name
 * and its chord in a §23 tooltip on hover or focus (2026-08-19).
 *
 * It takes the painted `active` id and a callback and reads no app store of
 * its own. The one thing it does read is the keymap, through `shortcutLabel`
 * during render — that is how a rebind reaches the tooltip without any caller
 * threading chords in, and it is the same read every other tooltip does.
 *
 * Arrow-key roving focus (the usual Tabs-pattern extra `settings-nav.tsx`
 * implements) is deliberately not built here — every chip stays in the natural
 * tab order instead.
 */
export function DockTabs({ items, active, onSelect }: DockTabsProps) {
  return (
    <div class="dock-tabs" role="tablist" aria-label="Side panel">
      {items.map((item) => (
        <DockTabChip
          key={item.id}
          item={item}
          active={item.id === active}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
