import { DeckIcon, FEATURE_ICON } from '../controls/deck-icon';
import type { DockTabDescriptor, DockTabId } from './dock-tab-registry';

interface DockTabsProps {
  readonly items: readonly DockTabDescriptor[];
  readonly active: DockTabId;
  onSelect(id: DockTabId): void;
}

/**
 * The docked panel's own tab row — switches which of the panel's surfaces
 * (explorer / usage / sessions) is showing. A `role="tablist"` of `role="tab"`
 * chips, each icon + label; the active chip carries DL-21.1's full
 * `--tab-active-bg` wash, idle chips carry none, and hover is the quieter
 * DL-21.2 wash — the same selection language `settings-nav.tsx` and
 * `usage-nav.tsx` already use, just laid out as a row instead of a rail.
 *
 * State-free by design: it takes the painted `active` id and a callback, and
 * reads no store. Arrow-key roving focus (the usual Tabs-pattern extra
 * `settings-nav.tsx` implements) is deliberately not built here — every chip
 * stays in the natural tab order instead.
 */
export function DockTabs({ items, active, onSelect }: DockTabsProps) {
  return (
    <div class="dock-tabs" role="tablist" aria-label="Side panel">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            class={`dock-tabs__chip ${isActive ? 'is-active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            <DeckIcon icon={item.icon} size={FEATURE_ICON} class="feature-glyph" />
            <span class="dock-tabs__label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
