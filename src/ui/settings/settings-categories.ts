import type { ComponentType } from "preact";
import type { CategoryId } from "./active-category-store";
import { AppearanceSection } from "./sections/appearance-section";
import { TerminalSection } from "./sections/terminal-section";
import { AgentsSection } from "./sections/agents-section";
import { BrowserSection } from "./sections/browser-section";
import { LinksEditorSection } from "./sections/links-editor-section";
import { NotificationsSection } from "./sections/notifications-section";
import { ShortcutsSection } from "./sections/shortcuts-section";
import { AboutSection } from "./sections/about-section";
import { ResetSection } from "./sections/reset-section";

/**
 * The one section panel the rail swaps content into. A single stable id (not
 * one per category) because only one panel is ever mounted — every tab's
 * `aria-controls` has to point at an element that actually exists, and a
 * per-category id would leave four of the five dangling.
 */
export const SECTION_PANEL_ID = "settings-section-panel";

/** Id of a category's rail tab — the panel points back at it via `aria-labelledby`. */
export function categoryTabId(id: CategoryId): string {
  return `settings-tab-${id}`;
}

export interface SettingsCategory {
  readonly id: CategoryId;
  /** Lowercase display label (DL-11.4) — distinct from `id`. */
  readonly label: string;
  /**
   * One sentence, printed under the section title (2026-08-19).
   *
   * It says what the category is FOR, not what each row does — the rows say
   * that themselves — and it is written against the rows that are actually
   * mounted. A description promising a control the section does not hold is
   * worse than none: the user goes looking for it.
   */
  readonly description: string;
  readonly Section: ComponentType;
}

/**
 * The navigable rail categories, in display order — the extension point for a
 * future category is one entry here plus one file under `sections/`, no edit
 * to `settings-screen.tsx`. `shortcuts` was the first to arrive that way.
 *
 * `reset` is an ordinary category since 2026-08-19 (owner), and was a pinned
 * rail-foot action before that — DL-11.5 amended. The foot existed to keep a
 * destructive action out of the navigable list, but the rail is 220px wide, so
 * the row had to stack its label over its button and still print a
 * three-line description in a column sized for one word. Reset is the same
 * shape as every other stop: a name you click, and content on the right. What
 * makes it safe is the native confirm it has always raised, not where it sat.
 *

 * `colors` is absent since 2026-08-16 for a different reason: four colour rows
 * that only ever edit the running theme were a whole rail stop away from the
 * theme picker that clears them, so they moved into `appearance` as a group
 * ([`color-overrides.tsx`](./color-overrides.tsx)).
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    label: "Appearance",
    description:
      "Choose how Deck looks and arrange the chrome around your work.",
    Section: AppearanceSection,
  },
  {
    id: "browser",
    label: "Browser",
    description: "Set the page the browser tab opens on.",
    Section: BrowserSection,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Tune how much scroll history each pane keeps.",
    Section: TerminalSection,
  },
  {
    id: "agents",
    label: "Agents",
    description: "Manage detected tools and add commands Deck can launch.",
    Section: AgentsSection,
  },
  {
    id: "links-editor",
    label: "Links & editor",
    description: "Choose which app opens a path that no open workspace holds.",
    Section: LinksEditorSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    description: "Review and record the keys used for common actions.",
    Section: ShortcutsSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Decide when background agents should ask for attention.",
    Section: NotificationsSection,
  },
  {
    id: "about",
    label: "About",
    description: "See this Deck build and check for a newer release.",
    Section: AboutSection,
  },
  // Last on purpose: it is still the one stop that throws work away, and the
  // end of the list is where a reader expects that (DL-11.5, amended).
  {
    id: "reset",
    label: "Reset",
    description:
      "Return every preference to the state a fresh install starts in.",
    Section: ResetSection,
  },
];
