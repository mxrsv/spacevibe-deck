/**
 * Category icons for the settings rail — Lucide through `DeckIcon` at 16px
 * (`DL-11.3`, `DL-14.1`). These stay as named semantic components so
 * `settings-categories.ts` keeps describing categories, not icon libraries:
 * changing which pictogram means "colors" is one edit here.
 */

import {
  AppWindow,
  Bell,
  Bot,
  Download,
  Link,
  Palette,
  SquareTerminal,
} from "lucide-preact";
import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";

export function AppearanceIcon() {
  return <DeckIcon icon={AppWindow} size={RAIL_ICON} />;
}

export function ColorsIcon() {
  return <DeckIcon icon={Palette} size={RAIL_ICON} />;
}

export function TerminalIcon() {
  return <DeckIcon icon={SquareTerminal} size={RAIL_ICON} />;
}

export function LinksEditorIcon() {
  return <DeckIcon icon={Link} size={RAIL_ICON} />;
}

export function NotificationsIcon() {
  return <DeckIcon icon={Bell} size={RAIL_ICON} />;
}

/** An arrow landing on a baseline — the update, not a generic info circle. */
export function AboutIcon() {
  return <DeckIcon icon={Download} size={RAIL_ICON} />;
}

export function AgentsIcon() {
  return <DeckIcon icon={Bot} size={RAIL_ICON} />;
}
