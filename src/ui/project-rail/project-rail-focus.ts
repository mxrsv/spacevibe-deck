/**
 * Where the keyboard goes when the row it stood on leaves the list (archived, hidden, closed,
 * removed). The browser drops focus to <body> then, and the next Tab starts the page over.
 *
 * `onFocusCapture` on the list calls `rememberRailFocus`; whoever notices the loss calls
 * `recoverRailFocus`: the list after each render, and a popup once it has finished closing
 * (it hands focus back to a trigger that no longer exists). The stop that takes the vanished
 * one's place gets the focus, or the one before it when it was the last.
 */

/** Project headers, section heads and rows: what the arrow keys walk. */
export const RAIL_STOPS = "[data-rail-project],[data-rail-section],[data-rail-row]";

interface Memory {
  readonly root: HTMLElement;
  readonly stop: HTMLElement;
  readonly index: number;
}

let memory: Memory | null = null;

/** A hover button stands for the stop it sits beside; anything else inside the list, for itself. */
function stopOf(target: HTMLElement): HTMLElement {
  const owner = target.closest("[data-rail-item]");
  return (
    owner?.querySelector<HTMLElement>(RAIL_STOPS) ??
    target.closest<HTMLElement>(RAIL_STOPS) ??
    target
  );
}

export function rememberRailFocus(root: HTMLElement, target: Element): void {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const stop = stopOf(target);
  // How many stops come before it: the slot its successor will take when it goes.
  const index = [...root.querySelectorAll(RAIL_STOPS)].filter(
    (other) =>
      other !== stop && other.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).length;
  memory = { root, stop, index };
}

/** For tests: the memory outlives a mounted list. */
export function forgetRailFocus(): void {
  memory = null;
}

export function recoverRailFocus(): void {
  if (memory === null || memory.stop.isConnected || document.activeElement !== document.body) {
    return;
  }
  const stops = [...memory.root.querySelectorAll<HTMLElement>(RAIL_STOPS)];
  const next = stops[Math.min(memory.index, stops.length - 1)];
  memory = null;
  next?.focus();
}
