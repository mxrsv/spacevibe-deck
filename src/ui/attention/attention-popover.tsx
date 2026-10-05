import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { useStageOverlayFlag } from "../worktree-card-menus";
import type { AttentionEntry, AttentionList } from "../attention-list-model";
import { AttentionPanel } from "./attention-panel";
import { placePopover } from "./attention-placement";

/**
 * The needs-you panel, hung from its chip (DL-13.1, DL-13.2).
 *
 * Dismissal is `ToolbarOverflowMenu`'s: Escape, a press outside, or completing
 * the action. It deliberately does NOT close on scroll, as the hover-raised
 * rail popovers do (DL-13.7): this one is raised by a press, a terminal's own
 * viewport scrolls whenever an agent prints, and a capture-phase scroll
 * listener would take the list away from under the pointer on every line.
 *
 * Portalled to `<body>`, like the space card: it is placed over the stage, so
 * it must sit above whatever clips or transforms the strip it hangs from, and
 * `useStageOverlayFlag` hides the browser tab's native view for as long as it
 * is open, since a DOM surface cannot cover a `WebContentsView`.
 */

export interface AttentionPopoverProps {
  readonly list: AttentionList;
  /** The chip's rect when it was pressed. */
  readonly anchor: Pick<DOMRect, "right" | "bottom">;
  /** The chip — its own press toggles, so it must not close the surface too. */
  readonly trigger: HTMLElement | null;
  onChoose(entry: AttentionEntry): void;
  /**
   * Escape or a press outside. `restoreFocus` is true for Escape, which
   * returns the keyboard to the chip; a press outside has already put the
   * focus where the user pointed it.
   */
  onDismiss(restoreFocus: boolean): void;
}

export function AttentionPopover({
  list,
  anchor,
  trigger,
  onChoose,
  onDismiss,
}: AttentionPopoverProps) {
  const holder = useRef<HTMLDivElement>(null);
  useStageOverlayFlag();

  // Focus lands on the first row when the surface opens, as it does in the
  // toolbar menu; arrows then move it (see `AttentionPanel`).
  useEffect(() => {
    holder.current?.querySelector<HTMLElement>(".attn-row")?.focus();
  }, []);

  // A row that vanishes under the keyboard (the pane was checked elsewhere)
  // drops focus on `<body>`, where Escape and the arrows would reach nothing.
  // Only that case is repaired: focus the user put anywhere else is theirs.
  useLayoutEffect(() => {
    if (document.activeElement === document.body) {
      holder.current?.querySelector<HTMLElement>(".attn-row")?.focus();
    }
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (holder.current?.contains(target) !== true && trigger?.contains(target) !== true) {
        onDismiss(false);
      }
    };
    // Capture phase and stopped, as every other dismissible surface does it
    // (`useDismiss`): a terminal is one element away and reads raw keys, so an
    // Escape that only closed this and kept travelling would reach the agent.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss(true);
      }
    };
    // Focus leaving for somewhere that is neither the surface nor the chip —
    // a chord such as ⌘⇧A sending it to a pane — ends the popover. A null
    // `relatedTarget` (a press on a scrollbar, the window losing focus) does
    // not: nothing was chosen.
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as Node;
      if (holder.current?.contains(target) !== true && trigger?.contains(target) !== true) {
        onDismiss(false);
      }
    };
    // The anchor is a viewport coordinate; a resize moves the chip from under it.
    const onResize = (): void => onDismiss(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("resize", onResize);
    };
  }, [trigger, onDismiss]);

  const placed = placePopover(anchor, { width: window.innerWidth, height: window.innerHeight });

  return createPortal(
    <div ref={holder} class="attn-pop-holder">
      <AttentionPanel
        list={list}
        onChoose={onChoose}
        floating
        style={{
          right: `${placed.right}px`,
          top: `${placed.top}px`,
          maxHeight: `${placed.maxHeight}px`,
        }}
      />
    </div>,
    document.body,
  );
}
