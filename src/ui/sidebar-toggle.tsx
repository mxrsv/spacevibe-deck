import { PanelLeft } from "lucide-preact";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";

interface SidebarToggleProps {
  /** Painted state, not the setting: a live drag arms this before it writes. */
  readonly collapsed: boolean;
  onToggle(): void;
}

/**
 * The navigation sidebar's own hide control (DL-18.9).
 *
 * A component rather than markup inlined at its mount, because the gallery
 * composes `DesktopChrome` and its stage itself: anything written inside
 * `App`'s stage JSX is invisible to every specimen, so the shell the gallery
 * photographs would be missing a control the shipped shell has.
 *
 * State-free on purpose. It takes the painted `collapsed` and a callback and
 * reads no store, so a specimen can drive it from a local signal while `App`
 * drives it from settings — one component, one look, two owners.
 */
export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  const label = collapsed ? "Expand the sidebar" : "Collapse the sidebar";
  return (
    <button
      type="button"
      class={`iconbtn ${collapsed ? "is-active" : ""}`}
      aria-label={label}
      aria-pressed={collapsed}
      title={label}
      onClick={onToggle}
    >
      <DeckIcon icon={PanelLeft} size={CHROME_ICON} />
    </button>
  );
}
