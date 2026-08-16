/**
 * The focus ping: a 1.5s ring on the pane the rail just sent focus to.
 *
 * The agent rail's chips and its expanded per-agent rows activate an EXACT
 * pane (`docs/specs/2026-08-16-agent-status-rail-design.md` §2.2), so focus
 * can land anywhere inside a grid of visually identical terminals. Without an
 * answer from the pane, the user has to re-find the thing they just asked
 * for, which is the whole cost the rail exists to remove. 1.5s is long enough
 * for an eye that was looking at the rail to catch the arrival, and short
 * enough not to become decor — DL-27.7 carries that exception to DL-1.2's
 * 300ms cap, scoped to this one effect and nothing else.
 *
 * This module is the DOM half only; the `.pane-ping` class in `styles.css`
 * owns the animation (an inset hairline whose `opacity` animates — DL-1.3 is
 * NOT amended, so never a blurred or offset glow) and skips it under
 * `prefers-reduced-motion`.
 *
 * Pane slots are built imperatively by `layout-engine.ts`, not by Preact, so
 * the ping is appended by hand rather than rendered.
 */

const PING_CLASS = "pane-ping";

/**
 * Ring the pane's border so the eye can find where focus went.
 *
 * The element is REPLACED rather than reused: a CSS animation only restarts
 * when its element is new, so asking for the same pane twice has to hand the
 * browser a fresh node or the second request is silent. The sweep also clears
 * every other slot, so two rings never burn at once.
 *
 * There is deliberately NO cleanup timer. The span is inert
 * (`pointer-events: none`, `aria-hidden`), so a finished ping costs nothing
 * lying there; the next ping removes it, and a layout rebuild replaces the
 * slot wholesale. A timer would only add a second owner racing the CSS.
 *
 * A missing slot is a complete no-op: the layout is rebuilt imperatively and
 * a pane can close between the rail click and this call.
 */
export function pingPane(paneId: number, root?: ParentNode): void {
  const scope = root ?? document;
  const slot = scope.querySelector(`.pane-slot[data-pane-id="${paneId}"]`);
  if (slot === null) {
    return;
  }
  for (const stale of scope.querySelectorAll(`.${PING_CLASS}`)) {
    stale.remove();
  }
  const ping = document.createElement("span");
  ping.className = PING_CLASS;
  ping.setAttribute("aria-hidden", "true");
  slot.appendChild(ping);
}
