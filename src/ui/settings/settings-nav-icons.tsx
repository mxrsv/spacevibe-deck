/**
 * Category icons for the settings rail — Phosphor through `DeckIcon` at 16px
 * (`DL-11.3`, `DL-14.1`). These stay as named semantic components so
 * `settings-categories.ts` keeps describing categories, not icon libraries:
 * changing which pictogram means "appearance" is one edit here.
 */
import {
  AppWindow,
  Bell,
  Command,
  DownloadSimple,
  Globe,
  Link,
  Robot,
  TerminalWindow,
} from "@phosphor-icons/react";

import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";

export function AppearanceIcon() {
  return <DeckIcon icon={AppWindow} size={RAIL_ICON} />;
}

export function TerminalIcon() {
  return <DeckIcon icon={TerminalWindow} size={RAIL_ICON} />;
}

export function BrowserIcon() {
  return <DeckIcon icon={Globe} size={RAIL_ICON} />;
}

export function LinksEditorIcon() {
  return <DeckIcon icon={Link} size={RAIL_ICON} />;
}

export function NotificationsIcon() {
  return <DeckIcon icon={Bell} size={RAIL_ICON} />;
}

/** An arrow landing on a baseline — the update, not a generic info circle. */
export function AboutIcon() {
  return <DeckIcon icon={DownloadSimple} size={RAIL_ICON} />;
}

export function AgentsIcon() {
  return <DeckIcon icon={Robot} size={RAIL_ICON} />;
}

/**
 * The ⌘ loop — what a chord IS, rather than a keyboard outline, which reads as
 * "typing" and would collide with what `TerminalWindow` already means here.
 * It stays right on Windows too: the glyph is the universal mark for a
 * shortcut, not a claim about which modifier key is pressed.
 */
export function ShortcutsIcon() {
  return <DeckIcon icon={Command} size={RAIL_ICON} />;
}
