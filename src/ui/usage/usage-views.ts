import type { ComponentType } from 'preact';
import type { UsageViewId } from './active-usage-view-store';
import { BreakdownIcon, DailyIcon, OverviewIcon } from './usage-nav-icons';
import { OverviewSection } from './sections/overview-section';
import { DailySection } from './sections/daily-section';
import { BreakdownSection } from './sections/breakdown-section';

/**
 * The one section panel the rail swaps content into. A single stable id, not
 * one per view: only one panel is ever mounted, and every tab's
 * `aria-controls` has to point at an element that exists — per-view ids would
 * leave two of the three dangling. Same reasoning as
 * `settings-categories.ts`'s `SECTION_PANEL_ID`.
 */
export const VIEW_PANEL_ID = 'usage-view-panel';

/** Id of a view's rail tab — the panel points back at it via `aria-labelledby`. */
export function viewTabId(id: UsageViewId): string {
  return `usage-tab-${id}`;
}

export interface UsageView {
  readonly id: UsageViewId;
  /** Lowercase display label (DL-11.4) — distinct from `id`. */
  readonly label: string;
  readonly Icon: ComponentType;
  readonly Section: ComponentType;
}

/**
 * The three views, in display order (spec §Surface). Adding a fourth is one
 * entry here plus one file under `sections/` — no edit to `usage-screen.tsx`.
 */
export const USAGE_VIEWS: readonly UsageView[] = [
  {
    id: 'overview',
    label: 'Overview',
    Icon: OverviewIcon,
    Section: OverviewSection,
  },
  { id: 'daily', label: 'Daily', Icon: DailyIcon, Section: DailySection },
  {
    id: 'breakdown',
    label: 'Breakdown',
    Icon: BreakdownIcon,
    Section: BreakdownSection,
  },
];
