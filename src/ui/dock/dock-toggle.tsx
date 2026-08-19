import { SidebarSimple } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { shortcutLabel } from "../../lib/shortcut-label";
import {
  ActionTooltip,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import {
  CHROME_ICON,
  DeckIcon,
  type DeckIconSize,
} from "../controls/deck-icon";

interface DockToggleProps {
  readonly open: boolean;
  /**
   * `CHROME_ICON` unless a mount says otherwise. Explicit rather than derived
   * from `open`, which happens to correlate: the dock header draws the larger
   * glyph because it is a cluster of feature entry points (DL-14.2), not
   * because the column is open, and keying geometry off state would make the
   * next mount's size an accident.
   */
  readonly size?: DeckIconSize;
  onToggle(): void;
}

/**
 * The docked side panel's own hide control — the mirror of `SidebarToggle`
 * (`src/ui/sidebar-toggle.tsx`), same `iconbtn` class, same `aria-pressed`-only
 * shape (no painted state, DL-21.8), drawing the same `SidebarSimple` mirrored since this
 * one hides a column on the opposite edge — Phosphor draws the mark facing
 * left only, so the flip is a prop rather than a second icon
 * (2026-08-16). It has two mounts, exactly as `SidebarToggle` does
 * (2026-08-19): while the column is SHOWN it sits at the trailing end of that
 * column's own header (`dock-panel.tsx`), the outer edge of the thing it
 * hides; while the column is GONE it sits on the stage strip, because a
 * closed panel has no room left to hold its own way back open. `App` gates
 * the stage mount on the panel being absent, so only one is ever on screen.
 *
 * Since 2026-08-19 it says its name and its chord in a §23 tooltip, the same
 * one the dock's tabs and the feature toolbar draw, and the native `title`
 * that used to carry the name is gone — two tooltips for one control is one
 * too many. Both mounts get it: they are one control in two places.
 *
 * State-free like its sibling: it takes the painted `open` and a callback and
 * reads no app store, so a specimen can drive it locally while `App` drives it
 * from settings. `shortcutLabel` reads the keymap during render, which is how
 * a rebind reaches the tooltip.
 */
export function DockToggle({
  open,
  size = CHROME_ICON,
  onToggle,
}: DockToggleProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const label = open ? "Hide the side panel" : "Show the side panel";
  const tooltipId = "dock-toggle-tip";

  return (
    <>
      <button
        ref={ref}
        type="button"
        class="iconbtn"
        aria-label={label}
        aria-pressed={open}
        aria-describedby={tooltip.anchor !== null ? tooltipId : undefined}
        onPointerEnter={(event) => tooltip.open(event.currentTarget)}
        onPointerLeave={() => {
          if (document.activeElement !== ref.current) {
            tooltip.close();
          }
        }}
        onFocus={(event) => tooltip.open(event.currentTarget)}
        onBlur={() => tooltip.close()}
        onClick={onToggle}
      >
        <DeckIcon icon={SidebarSimple} size={size} mirrored />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={label}
          shortcut={shortcutLabel("toggle-dock")}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}
