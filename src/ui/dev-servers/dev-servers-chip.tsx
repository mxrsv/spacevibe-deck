import { HardDrives } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "preact/hooks";
import type { DevServerCapability } from "../../dev-servers/dev-server-types";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { chipSummary } from "./dev-server-model";
import { DevServersPopover, type DevServersPopoverProps } from "./dev-servers-popover";

/**
 * The strip's dev servers chip (DL-36.1): the number of servers running in the
 * active checkout, and beside it a dot that is live only while that number is
 * above zero. A press opens the popover.
 *
 * Unlike the needs-you chip it stays at zero — "nothing is running" is an answer
 * the user came for — but it is absent while the host cannot discover anything
 * (Tauri, the browser preview, Windows and Linux) and until the host has said
 * so, because a chip that offers an empty list there would be a lie.
 *
 * It owns nothing but its open state; the scan itself is the store's.
 */

export interface DevServersChipProps extends Omit<
  DevServersPopoverProps,
  "anchor" | "trigger" | "onDismiss" | "onDone"
> {
  readonly capability: DevServerCapability | null;
}

const TOOLTIP_ID = "action-tip-dev-servers";

export function DevServersChip({ capability, ...popover }: DevServersChipProps) {
  const [anchor, setAnchor] = useState<Pick<DOMRect, "right" | "bottom"> | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();

  const dismiss = useCallback((restoreFocus: boolean): void => {
    setAnchor(null);
    if (restoreFocus) {
      chipRef.current?.focus();
    }
  }, []);

  if (capability === null || !capability.available) {
    return null;
  }

  const { running, scanFailed } = chipSummary(
    popover.snapshot,
    popover.failed,
    popover.subject,
    popover.scans,
  );
  const open = anchor !== null;
  // The word is for a screen reader, which cannot see the dot's colour.
  const name = `Dev servers — ${running} running${scanFailed ? ", last scan failed" : ""}`;
  // red once the reading is not to be trusted; green only while something runs.
  const dot = scanFailed ? "failed" : running > 0 ? "running" : null;

  return (
    <span class="attn-chip-slot">
      <button
        ref={chipRef}
        type="button"
        class="attn-chip dsv-chip"
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The popover has already answered what the tooltip would say.
        aria-describedby={tooltip.anchor !== null && !open ? TOOLTIP_ID : undefined}
        {...tooltipTriggerProps(tooltip, chipRef)}
        onClick={(event) => {
          tooltip.close();
          if (open) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ right: rect.right, bottom: rect.bottom });
        }}
      >
        <DeckIcon icon={HardDrives} size={CHROME_ICON} />
        <span class="dsv-chip__count" aria-hidden="true">
          {running}
        </span>
        {dot !== null && <span class="dsv-chip__dot" data-tone={dot} aria-hidden="true" />}
      </button>
      {tooltip.anchor !== null && !open && (
        <ActionTooltip
          id={TOOLTIP_ID}
          label={name}
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
      {anchor !== null && (
        <DevServersPopover
          {...popover}
          anchor={anchor}
          trigger={chipRef.current}
          onDismiss={dismiss}
          onDone={() => dismiss(false)}
        />
      )}
    </span>
  );
}
