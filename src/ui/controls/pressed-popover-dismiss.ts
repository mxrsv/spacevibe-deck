import { useEffect } from "preact/hooks";

/**
 * How a press-opened popover goes away (DL-13.2): Escape, a press outside, focus
 * leaving for somewhere else, or the window resizing under its fixed anchor.
 * Shared by the strip's needs-you and dev servers popovers, which are both hung
 * from a chip and portalled to `<body>`.
 *
 * It deliberately does NOT close on scroll, as the hover-raised rail popovers do
 * (DL-13.7): this kind is raised by a press, a terminal's own viewport scrolls
 * whenever an agent prints, and a capture-phase scroll listener would take the
 * surface away from under the pointer on every line.
 *
 * `restoreFocus` is true for Escape, which returns the keyboard to the trigger;
 * a press outside has already put the focus where the user pointed it.
 */
export function usePressedPopoverDismiss(
  holder: { readonly current: HTMLElement | null },
  trigger: HTMLElement | null,
  onDismiss: (restoreFocus: boolean) => void,
): void {
  useEffect(() => {
    const outside = (target: Node): boolean =>
      holder.current?.contains(target) !== true && trigger?.contains(target) !== true;
    // The trigger is exempt: its own press toggles, so it must not close the
    // surface through this path too.
    const onPointerDown = (event: PointerEvent): void => {
      if (outside(event.target as Node)) {
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
    // Focus leaving for somewhere that is neither the surface nor the trigger —
    // a chord such as ⌘⇧A sending it to a pane — ends the popover. A null
    // `relatedTarget` (a press on a scrollbar, the window losing focus) does
    // not: nothing was chosen.
    const onFocusIn = (event: FocusEvent): void => {
      if (outside(event.target as Node)) {
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
  }, [holder, trigger, onDismiss]);
}
