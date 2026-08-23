/**
 * The one control that flips a markdown document between the rendered view and
 * its source (design 2026-08-23 §4).
 *
 * It sits at the surface's top-right corner, in BOTH modes — a control that
 * only exists in one of the two views is a one-way door, and source mode is
 * exactly where the way back matters. Icon-only per DL-23.10, with the §23
 * tooltip and no native `title`, and the icon states the mode it would switch
 * TO rather than the mode it is in: the surface underneath already says which
 * one that is.
 *
 * State-free like `DockToggle`, which it copies wholesale: it takes the
 * painted mode and a callback, reads no store, and resolves its chord from the
 * action id through `shortcutLabel` so a rebind reaches the text — and so
 * Windows, which has no binding for this action, prints no chord rather than
 * the wrong one.
 */
import { Article, CodeSimple } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { shortcutLabel } from "../../lib/shortcut-label";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../../ui/controls/action-tooltip";
import { DeckIcon, FEATURE_ICON } from "../../ui/controls/deck-icon";
import type { ViewMode } from "../markdown-policy";

export interface ViewModeToggleProps {
  readonly mode: ViewMode;
  onToggle(): void;
}

const TOOLTIP_ID = "markdown-view-toggle-tip";

export function ViewModeToggle({ mode, onToggle }: ViewModeToggleProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const rendered = mode === "rendered";
  // Sentence case at this layer (DL-23.2): the registry keeps its Title Case
  // menu label, and neither surface leaks its grammar into the other.
  const label = rendered ? "Show the source" : "Show it rendered";

  return (
    <>
      <button
        ref={ref}
        type="button"
        class="iconbtn md-view-toggle"
        aria-label={label}
        aria-describedby={tooltip.anchor !== null ? TOOLTIP_ID : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={onToggle}
      >
        <DeckIcon icon={rendered ? CodeSimple : Article} size={FEATURE_ICON} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={TOOLTIP_ID}
          label={label}
          shortcut={shortcutLabel("toggle-markdown-view")}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}
