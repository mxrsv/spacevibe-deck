/**
 * One answer to "what can Tab land on, and where does it wrap".
 *
 * Two surfaces contain focus — the modal shell (DL-29) and the full-window
 * Settings screen (DL-11) — and until 2026-08-19 each carried its own copy of
 * the selector and the wrap algorithm. They had already diverged: the Settings
 * copy grew four filters the modal's never got, one of them added the same day
 * to fix a real leak (a roving `tabindex="-1"` segment being counted as the
 * last stop). A second definition of "focusable" is the kind of thing that
 * only ever drifts in one direction, so both call this now.
 */

/**
 * Everything the browser would put in the tab order.
 *
 * `tabIndex >= 0` is checked separately in `focusableItems`, NOT here: a
 * `<button tabindex="-1">` matches `button:not([disabled])` first, so the
 * `[tabindex]` clause below never gets to reject it. That is exactly what a
 * roving-tabindex control (a radio group, a rail of tabs) is made of.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The tab stops inside `root`, in document order.
 *
 * `root` itself is never included — `querySelectorAll` does not return it —
 * which is what a container carrying its own `tabIndex={0}` (the modal panel)
 * relies on: it is somewhere to put focus, not a stop the cycle returns to.
 */
export function focusableItems(root: HTMLElement): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      // A control inside a disabled fieldset is disabled by inheritance, so
      // the `:not([disabled])` clauses above cannot see it.
      element.closest("fieldset[disabled]") === null &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden"),
  );
}

/**
 * Keep Tab inside `root`, wrapping at both ends.
 *
 * Call it from a keydown handler that has already established the key is Tab.
 * Focus sitting OUTSIDE `root` is pulled back in rather than advanced — a
 * surface that covers the window does not remove the app behind it from the
 * document, so the pane that had focus when the surface opened still has it.
 *
 * `fallback` is focused when `root` holds no tab stop at all; without it Tab
 * would escape from an empty surface. The modal panel passes itself.
 */
export function trapTab(
  event: KeyboardEvent,
  root: HTMLElement | null,
  fallback?: HTMLElement | null,
): void {
  if (root === null) {
    return;
  }
  const items = focusableItems(root);
  if (items.length === 0) {
    if (fallback != null) {
      event.preventDefault();
      fallback.focus();
    }
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active) && active !== root;
  if (!inside) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
