import { SidebarSimple } from '@phosphor-icons/react';
import { CHROME_ICON, DeckIcon } from '../controls/deck-icon';

interface DockToggleProps {
  readonly open: boolean;
  onToggle(): void;
}

/**
 * The docked side panel's own hide control — the mirror of `SidebarToggle`
 * (`src/ui/sidebar-toggle.tsx`), same `iconbtn` class, same `aria-pressed`-only
 * shape (no painted state, DL-21.8), drawing the same `SidebarSimple` mirrored since this
 * one hides a column on the opposite edge — Phosphor draws the mark facing
 * left only, so the flip is a prop rather than a second icon
 * (2026-08-16). It lives on the stage, not on the panel
 * itself, for the reason `SidebarToggle` lives there: a closed panel has no
 * room left to hold its own way back open, so the control has to sit
 * somewhere that survives the panel closing.
 *
 * State-free like its sibling: it takes the painted `open` and a callback and
 * reads no store, so a specimen can drive it locally while `App` drives it
 * from settings.
 */
export function DockToggle({ open, onToggle }: DockToggleProps) {
  const label = open ? 'Hide the side panel' : 'Show the side panel';
  return (
    <button
      type="button"
      class="iconbtn"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={onToggle}
    >
      <DeckIcon icon={SidebarSimple} size={CHROME_ICON} mirrored />
    </button>
  );
}
