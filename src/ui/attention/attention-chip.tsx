import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import type { AttentionEntry, AttentionList } from "../attention-list-model";
import { AttentionPopover } from "./attention-popover";

/**
 * The strip's needs-you chip (DL-27.26, amended 2026-10-06): the number of
 * panes that are `asked` or `failed`, a red dot when any failed and a yellow
 * one otherwise, and absent at zero. A press opens the list of exactly those
 * panes; choosing one focuses that pane and acknowledges no other.
 *
 * It owns nothing but its open state. The list is projected in, and the focus
 * is a callback the app passes — the same preflighted `activateForAttention`
 * the rail's rows use, so overlays are dismissed before the pane is shown.
 */

export interface AttentionChipProps {
  readonly list: AttentionList;
  /** Focus exactly this pane (and acknowledge only it). */
  onFocusPane(tabIndex: number, paneId: number): void;
}

export function AttentionChip({ list, onFocusPane }: AttentionChipProps) {
  const count = list.entries.length;
  const [anchor, setAnchor] = useState<Pick<DOMRect, "right" | "bottom"> | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();

  // The last pane acknowledged takes the chip with it, and the list must not
  // come back already open if something needs the user again.
  useEffect(() => {
    if (count === 0) {
      setAnchor(null);
    }
  }, [count]);

  const dismiss = useCallback((restoreFocus: boolean): void => {
    setAnchor(null);
    if (restoreFocus) {
      chipRef.current?.focus();
    }
  }, []);

  if (count === 0) {
    return null;
  }

  const open = anchor !== null;
  // The word is for a screen reader, which cannot see the dot's colour.
  const name = `${count} need you`;
  const tooltipId = "action-tip-attention";

  const choose = (entry: AttentionEntry): void => {
    // Closed without handing the focus back: the pane the user chose takes it.
    setAnchor(null);
    onFocusPane(entry.tabIndex, entry.paneId);
  };

  return (
    <span class="attn-chip-slot">
      <button
        ref={chipRef}
        type="button"
        class="attn-chip"
        // DL-27.26: red once anything failed, yellow for a question. Never a
        // second colour for the same chip.
        data-tone={list.failedCount > 0 ? "failed" : "asked"}
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The popover has already answered what the tooltip would say.
        aria-describedby={tooltip.anchor !== null && !open ? tooltipId : undefined}
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
        <span class="attn-chip__dot" aria-hidden="true" />
        <span class="attn-chip__count" aria-hidden="true">
          {count}
        </span>
      </button>
      {tooltip.anchor !== null && !open && (
        <ActionTooltip
          id={tooltipId}
          label={name}
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
      {anchor !== null && (
        <AttentionPopover
          list={list}
          anchor={anchor}
          trigger={chipRef.current}
          onChoose={choose}
          onDismiss={dismiss}
        />
      )}
    </span>
  );
}
