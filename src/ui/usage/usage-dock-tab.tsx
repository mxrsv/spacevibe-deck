import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "preact/hooks";
import { shortcutLabel } from "../../lib/shortcut-label";
import { startUsagePolling, stopUsagePolling } from "../../usage/usage-store";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
import { toolbarLabel } from "../toolbar/toolbar-label";
import { UsageBody } from "./usage-body";

interface UsageDockTabProps {
  /** Opens the details page; `App` routes it through the `open-usage` action. */
  readonly onOpenDetails: () => void;
}

const DETAILS_TIP_ID = "usage-details-tip";

/**
 * Token usage as a tab of the docked side panel (DL-19.7).
 *
 * `UsageBody` is deliberately lifecycle-free — it renders whatever the store
 * holds — so whoever shows it owns the polling. The full-window screen used to
 * be that owner; this component is the dock's equivalent, and it exists as a
 * component rather than an effect inside `App` so the lifecycle is tied to the
 * tab being MOUNTED. Mount/unmount is exactly the transition that should start
 * and stop the poll: an effect keyed off settings would restart the poll on
 * every unrelated settings write. The details page holds its own claim on the
 * same poll, so closing either leaves the other running.
 *
 * The one control above the summary is the way into the page. Its tooltip is
 * the registry's own label and the live chord (DL-23), so a rebind reaches it.
 */
export function UsageDockTab({ onOpenDetails }: UsageDockTabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();

  useEffect(() => {
    startUsagePolling();
    return () => stopUsagePolling();
  }, []);

  return (
    <>
      <div class="usage-dock__bar">
        <button
          ref={buttonRef}
          type="button"
          class="sbtn sbtn--trail"
          aria-describedby={tooltip.anchor !== null ? DETAILS_TIP_ID : undefined}
          {...tooltipTriggerProps(tooltip, buttonRef)}
          onClick={onOpenDetails}
        >
          Details
          <DeckIcon icon={ArrowRight01Icon} size={GLYPH_INLINE} />
        </button>
        {tooltip.anchor !== null && (
          <ActionTooltip
            id={DETAILS_TIP_ID}
            label={toolbarLabel("open-usage")}
            shortcut={shortcutLabel("open-usage")}
            reason={null}
            anchor={tooltip.anchor}
          />
        )}
      </div>
      <UsageBody variant="dock" />
    </>
  );
}
