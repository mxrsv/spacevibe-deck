import { HardDrives } from "@phosphor-icons/react";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { placePopover } from "../attention/attention-placement";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { usePressedPopoverDismiss } from "../controls/pressed-popover-dismiss";
import { useStageOverlayFlag } from "../worktree-card-menus";
import { DevServersPanel, type DevServersPanelProps } from "./dev-servers-panel";

/**
 * The dev servers panel hung from its chip (DL-13.1, DL-13.2, DL-36.1).
 *
 * Portalled to `<body>` and raising the stage overlay flag for as long as it is
 * open, for the reason `AttentionPopover` gives: it is placed over the stage, and
 * a DOM surface cannot cover the browser tab's native view.
 */

/** The surface's width, and the same figure `.dsv-pop` declares. */
const POPOVER_WIDTH = 360;

export interface DevServersPopoverProps extends DevServersPanelProps {
  /** The chip's rect when it was pressed. */
  readonly anchor: Pick<DOMRect, "right" | "bottom">;
  /** The chip — its own press toggles, so it must not close the surface too. */
  readonly trigger: HTMLElement | null;
  onDismiss(restoreFocus: boolean): void;
}

/** The first action, else the scope select when no server is listed. */
function focusFirstStop(holder: HTMLElement | null): void {
  (
    holder?.querySelector<HTMLElement>("[data-col]") ?? holder?.querySelector<HTMLElement>("select")
  )?.focus();
}

export function DevServersPopover({
  anchor,
  trigger,
  onDismiss,
  onDone,
  ...panel
}: DevServersPopoverProps) {
  const holder = useRef<HTMLDivElement>(null);
  useStageOverlayFlag();
  usePressedPopoverDismiss(holder, trigger, onDismiss);

  // Focus lands on the first action when the surface opens (the scope select
  // when no server is listed), and the arrows walk the grid from there.
  useEffect(() => {
    focusFirstStop(holder.current);
  }, []);

  // A row that vanishes under the keyboard (the server stopped and aged out)
  // drops focus on `<body>`, where Escape and the arrows would reach nothing.
  // Only that case is repaired: focus the user put anywhere else is theirs.
  useLayoutEffect(() => {
    if (document.activeElement === document.body) {
      focusFirstStop(holder.current);
    }
  });

  const placed = placePopover(
    anchor,
    { width: window.innerWidth, height: window.innerHeight },
    POPOVER_WIDTH,
  );

  return createPortal(
    <div ref={holder} class="dsv-holder">
      <div
        class="dsv-pop"
        // DL-13.2: the surface is a dialog with a label.
        role="dialog"
        aria-label="Dev servers"
        style={{
          right: `${placed.right}px`,
          top: `${placed.top}px`,
          maxHeight: `${placed.maxHeight}px`,
        }}
      >
        <h2 class="dsv-pop__title">
          <DeckIcon icon={HardDrives} size={CHROME_ICON} />
          Dev servers
        </h2>
        <DevServersPanel {...panel} onDone={onDone} />
      </div>
    </div>,
    document.body,
  );
}
