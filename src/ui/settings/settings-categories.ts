import type { ComponentType } from "preact";
import type { CategoryId } from "./active-category-store";
import {
  AboutIcon,
  AgentsIcon,
  AppearanceIcon,
  ColorsIcon,
  LinksEditorIcon,
  NotificationsIcon,
  TerminalIcon,
} from "./settings-nav-icons";
import { AppearanceSection } from "./sections/appearance-section";
import { ColorsSection } from "./sections/colors-section";
import { TerminalSection } from "./sections/terminal-section";
import { AgentsSection } from "./sections/agents-section";
import { LinksEditorSection } from "./sections/links-editor-section";
import { NotificationsSection } from "./sections/notifications-section";
import { AboutSection } from "./sections/about-section";

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
  readonly Icon: ComponentType;
  readonly Section: ComponentType;
}

/**
 * The six navigable rail categories, in display order — the extension point
 * for a future category (agent config, keybindings) is one entry here plus
 * one file under `sections/`, no edit to `settings-screen.tsx`.
 *
 * `ResetSection` is deliberately absent: it is a pinned rail-foot action
 * (`settings-nav.tsx`), not a navigable category (plan §3 invariant).
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    label: "appearance",
    Icon: AppearanceIcon,
    Section: AppearanceSection,
  },
  { id: "colors", label: "colors", Icon: ColorsIcon, Section: ColorsSection },
  {
    id: "terminal",
    label: "terminal",
    Icon: TerminalIcon,
    Section: TerminalSection,
  },
  { id: "agents", label: "agents", Icon: AgentsIcon, Section: AgentsSection },
  {
    id: "links-editor",
    label: "links & editor",
    Icon: LinksEditorIcon,
    Section: LinksEditorSection,
  },
  {
    id: "notifications",
    label: "notifications",
    Icon: NotificationsIcon,
    Section: NotificationsSection,
  },
  { id: "about", label: "about", Icon: AboutIcon, Section: AboutSection },
];
