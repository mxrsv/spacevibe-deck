import { useEffect, useRef } from "preact/hooks";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { activeUsageView } from "./active-usage-view-store";
import { UsageNav } from "./usage-nav";
import { UsageStatus } from "./usage-status";
import { USAGE_VIEWS, VIEW_PANEL_ID, viewTabId } from "./usage-views";

interface UsageScreenProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The token usage screen: a full-window surface over the stage, rail left,
 * view right (DL-11.1). The view area owns all scrolling; the rail does not
 * scroll with it. Same shell as `SettingsScreen`, deliberately — the two are
 * mutually exclusive and a user who has learned one must recognise the other.
 *
 * Escape and mount-focus are carried over unchanged, `.xterm` guard included.
 * The guard is inert once the surface covers the window, but it is
 * load-bearing for a pane still holding focus at the moment of opening.
 *
 * Polling is keyed on the `open` PROP, with a cleanup, because this surface
 * never unmounts (`app.tsx` mounts it unconditionally, the way it mounts
 * Settings). A mount-keyed effect would start the 5 s poll at launch and run
 * it for the life of the process over a ~2.5 GB corpus. `useSignalEffect` is
 * the wrong tool here for a mechanical reason: it re-runs only when a signal
 * READ INSIDE IT changes, and `open` is a prop — the effect would run once,
 * closed, and never again.
 */
export function UsageScreen({ open, onClose }: UsageScreenProps) {
  const escRef = useRef<HTMLButtonElement>(null);

  // Move focus into the screen on open, so Escape reaches the handler below
  // instead of being swallowed by the terminal that had focus. preventScroll:
  // the view area scrolls, and stealing focus must not jump it.
  useEffect(() => {
    if (open) {
      escRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Scan on open, then poll while open; stop the moment it closes. The
  // cleanup also fires on unmount, so a torn-down window leaves no timer.
  useEffect(() => {
    if (!open) {
      return;
    }
    startUsagePolling();
    return () => stopUsagePolling();
  }, [open]);

  // Escape closes the screen — unless the key is headed for a terminal,
  // which owns its own Escape (vim, fzf, …).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      // A terminal owns its own Escape (vim, fzf) — leave it be. Guard the type:
      // keydown can target a non-Element (document/window) that has no closest().
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }
      // Blur first: a focused field commits its draft on blur, so closing
      // never silently drops what the user just typed. Nothing on this screen
      // is editable today; the rule is the shell's, not the content's.
      if (target instanceof HTMLElement) {
        target.blur();
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Falls back to the first view rather than rendering an empty panel: an
  // unknown id can only come from a stale signal, and a blank screen is a
  // worse answer than the default one.
  const active =
    USAGE_VIEWS.find((view) => view.id === activeUsageView.value) ??
    USAGE_VIEWS[0];
  const View = active.Section;

  return (
    <aside
      class={`usage-screen ${open ? "is-open" : ""}`}
      aria-label="Token usage"
      aria-hidden={!open}
    >
      <header class="usage-screen__head">
        <h2 class="usage-screen__path">
          <b>~</b>/deck/usage
        </h2>
        {/* The scope, stated where the numbers are: one OS user's history that
            still exists on one machine. Not "machine-wide", not "all-time" —
            the CLIs prune their own transcripts (spec §Goal). */}
        <span class="usage-screen__scope">this machine, this user</span>
        <button
          ref={escRef}
          type="button"
          class="usage-screen__esc"
          aria-label="Close token usage"
          onClick={onClose}
        >
          esc
        </button>
      </header>

      <UsageStatus
        snapshot={usageSnapshot.value}
        loading={usageLoading.value}
        stale={usageStale.value}
      />

      <div class="usage-screen__grid">
        <UsageNav />
        <section
          class="usage-screen__section"
          id={VIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={viewTabId(active.id)}
        >
          <View />
        </section>
      </div>
    </aside>
  );
}
