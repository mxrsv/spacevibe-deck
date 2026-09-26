import { usageLoading, usageSnapshot, usageStale } from "../../usage/usage-store";
import { OverviewSection } from "./sections/overview-section";
import { UsageStatus } from "./usage-status";

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
 * 2026-08-16 so the same status strip and overview can also render inside a
 * narrow docked column, not only the full-window screen. `UsageScreen` keeps
 * owning the shell around this: the `<aside>`, the header, mount-focus, Escape
 * handling and the `open`-keyed poll (`startUsagePolling`/`stopUsagePolling`)
 * all stay there — this component renders the store's current signals and
 * owns no lifecycle of its own. A dock consumer that mounts this while
 * `UsageScreen` is closed must drive that same poll itself.
 *
 * There is one view, so there is no view rail: the Daily and Breakdown views
 * were removed on 2026-09-26 and a tab strip with a single tab switches
 * nothing.
 *
 * Renders as a Fragment rather than a wrapping element: for `variant="screen"`
 * the two children keep the exact class names `UsageScreen` gave them
 * (`usage-screen__grid`, `usage-screen__section`), so they stay direct
 * children of `UsageScreen`'s `<aside>`. `variant="dock"` swaps in
 * `usage-dock__grid` / `usage-dock__section` instead, which tighten the
 * section's padding for the narrow column. A dock consumer must itself be a
 * `display: flex; flex-direction: column; min-height: 0;` box (the same role
 * `.usage-screen` plays for the screen variant) so `usage-dock__grid` can
 * size within it.
 */
export function UsageBody({ variant = "screen" }: UsageBodyProps) {
  const gridClass = variant === "dock" ? "usage-dock__grid" : "usage-screen__grid";
  const sectionClass = variant === "dock" ? "usage-dock__section" : "usage-screen__section";

  return (
    <>
      <UsageStatus
        snapshot={usageSnapshot.value}
        loading={usageLoading.value}
        stale={usageStale.value}
      />
      <div class={gridClass}>
        <section class={sectionClass}>
          <OverviewSection />
        </section>
      </div>
    </>
  );
}
