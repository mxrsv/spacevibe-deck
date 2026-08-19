/**
 * Replay the rail-click locator on one exact pane.
 *
 * Pane slots are owned by the imperative layout engine, so the locator is a
 * small inert DOM node rather than Preact state. Replacing the node restarts
 * its one-shot CSS animation even when the same agent row is pressed twice.
 */

const PING_CLASS = "pane-ping";

export function pingPane(paneId: number, root: ParentNode = document): void {
  const slot = root.querySelector(
    `.pane-slot[data-pane-id="${paneId}"]`,
  );
  if (slot === null) {
    return;
  }
  for (const stale of root.querySelectorAll(`.${PING_CLASS}`)) {
    stale.remove();
  }
  const ping = document.createElement("span");
  ping.className = PING_CLASS;
  ping.setAttribute("aria-hidden", "true");
  slot.appendChild(ping);
}
