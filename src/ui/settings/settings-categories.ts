import type { ComponentType } from "preact";
import type { CategoryId } from "./active-category-store";
import {
  AboutIcon,
  AgentsIcon,
  AppearanceIcon,
  BrowserIcon,
  LinksEditorIcon,
  NotificationsIcon,
  ShortcutsIcon,
  TerminalIcon,
} from "./settings-nav-icons";
import { AppearanceSection } from "./sections/appearance-section";
import { TerminalSection } from "./sections/terminal-section";
import { AgentsSection } from "./sections/agents-section";
import { BrowserSection } from "./sections/browser-section";
import { LinksEditorSection } from "./sections/links-editor-section";
import { NotificationsSection } from "./sections/notifications-section";
import { ShortcutsSection } from "./sections/shortcuts-section";
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
 * The navigable rail categories, in display order — the extension point for a
 * future category is one entry here plus one file under `sections/`, no edit
 * to `settings-screen.tsx`. `shortcuts` was the first to arrive that way.
 *
 * `ResetSection` is deliberately absent: it is a pinned rail-foot action
 * (`settings-nav.tsx`), not a navigable category (plan §3 invariant).
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
    Icon: AppearanceIcon,
    Section: AppearanceSection,
  },
  {
    id: "browser",
    label: "Browser",
    Icon: BrowserIcon,
    Section: BrowserSection,
  },
  {
    id: "terminal",
    label: "Terminal",
    Icon: TerminalIcon,
    Section: TerminalSection,
  },
  { id: "agents", label: "Agents", Icon: AgentsIcon, Section: AgentsSection },
  {
    id: "links-editor",
    label: "Links & editor",
    Icon: LinksEditorIcon,
    Section: LinksEditorSection,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    Icon: ShortcutsIcon,
    Section: ShortcutsSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    Icon: NotificationsIcon,
    Section: NotificationsSection,
  },
  { id: "about", label: "About", Icon: AboutIcon, Section: AboutSection },
];
