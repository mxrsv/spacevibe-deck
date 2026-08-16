import {
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { activeUsageView } from "./active-usage-view-store";
import { UsageNav } from "./usage-nav";
import { UsageStatus } from "./usage-status";
import { USAGE_VIEWS, VIEW_PANEL_ID, viewTabId } from "./usage-views";

export type UsageBodyVariant = "screen" | "dock";

interface UsageBodyProps {
  /**
   * "screen" (default) renders inside `UsageScreen`'s full-window shell.
   * "dock" renders the same content sized for a narrow docked column
   * (target 360-560px, default 420px).
   */
  readonly variant?: UsageBodyVariant;
}

/**
 * The token usage screen's content, extracted from `UsageScreen` on
 * 2026-08-16 so the same status strip, view rail and active view panel can
 * also render inside a narrow docked column, not only the full-window
 * screen. `UsageScreen` keeps owning the shell around this: the `<aside>`,
 * the header, mount-focus, Escape handling and the `open`-keyed poll
 * (`startUsagePolling`/`stopUsagePolling`) all stay there — this component
 * renders the store's current signals and owns no lifecycle of its own. A
 * dock consumer that mounts this while `UsageScreen` is closed must drive
 * that same poll itself.
 *
 * Renders as a Fragment rather than a wrapping element: for `variant="screen"`
 * the two children keep the exact class names `UsageScreen` gave them
 * (`usage-screen__grid`, `usage-screen__section`), so they stay direct
 * children of `UsageScreen`'s `<aside>` and every existing rule in
 * `styles.css` applies with zero delta and no new CSS. `variant="dock"` swaps
 * in `usage-dock__grid` / `usage-dock__section` instead, new selectors that
 * restyle the shared `.usage-nav` rail (row instead of column, bottom accent
 * instead of left) and tighten the section's padding via descendant rules —
 * `usage-nav.tsx` and `metric-table.tsx` are untouched, and a wide table still
 * gets its own DL-15.3 `overflow-x: auto` scroller rather than losing columns.
 * A dock consumer must itself be a `display: flex; flex-direction: column;
 * min-height: 0;` box (the same role `.usage-screen` plays for the screen
 * variant) so `usage-dock__grid` can size within it.
 *
 * `VIEW_PANEL_ID` and `viewTabId()` are shared, unscoped ids — fine today
 * because the screen and a dock panel are not expected to be mounted at the
 * same time. Mounting both variants simultaneously would duplicate DOM ids
 * and needs those made per-instance first.
 */
export function UsageBody({ variant = "screen" }: UsageBodyProps) {
  // Falls back to the first view rather than rendering an empty panel: an
  // unknown id can only come from a stale signal, and a blank screen is a
  // worse answer than the default one.
  const active =
    USAGE_VIEWS.find((view) => view.id === activeUsageView.value) ??
    USAGE_VIEWS[0];
  const View = active.Section;

  const gridClass =
    variant === "dock" ? "usage-dock__grid" : "usage-screen__grid";
  const sectionClass =
    variant === "dock" ? "usage-dock__section" : "usage-screen__section";

  return (
    <>
      <UsageStatus
        snapshot={usageSnapshot.value}
        loading={usageLoading.value}
        stale={usageStale.value}
      />
      <div class={gridClass}>
        <UsageNav />
        <section
          class={sectionClass}
          id={VIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={viewTabId(active.id)}
        >
          <View />
        </section>
      </div>
    </>
  );
}
