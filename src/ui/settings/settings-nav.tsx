import { useRef } from "preact/hooks";
import { activeCategory } from "./active-category-store";
import { categoryTabId, SECTION_PANEL_ID, SETTINGS_CATEGORIES } from "./settings-categories";

/**
 * The settings rail: one vertical list of category tabs, and nothing else.
 * Click sets `activeCategory.value` directly — a module signal, no prop
 * callback, same idiom `app.tsx` uses for `boardOpen.value = false`.
 * `↑`/`↓` wrap over the categories, the local roving-list idiom from
 * `open-board.tsx`'s `moveWorkspace`/`movePreset`
 * (`(index + step + length) % length`), and move DOM focus together with
 * the signal so the visibly-active item and the focused item never
 * disagree.
 *
 * The pinned Reset foot is gone since 2026-08-19 (owner, DL-11.5 amended):
 * `reset` is a registry category like every other stop, so it rides this
 * roving group and renders on the right. That deleted the rail's only
 * special case — a second mount point outside the list, with its own CSS
 * teaching one config row to stack because 220px could not hold it.
 *
 * `role="tablist"`/`role="tab"` — this is the Tabs pattern (a rail
 * selection swaps a single content panel), so vertical `↑`/`↓` roving and
 * `aria-selected` are the correct semantics, not an incidental choice.
 */
export function SettingsNav() {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectCategory = (index: number): void => {
    activeCategory.value = SETTINGS_CATEGORIES[index].id;
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    let step: 1 | -1;
    if (event.key === "ArrowDown") {
      step = 1;
    } else if (event.key === "ArrowUp") {
      step = -1;
    } else {
      return;
    }
    event.preventDefault();
    const length = SETTINGS_CATEGORIES.length;
    const currentIndex = SETTINGS_CATEGORIES.findIndex(
      (category) => category.id === activeCategory.value,
    );
    const from = currentIndex === -1 ? 0 : currentIndex;
    selectCategory((from + step + length) % length);
  };

  return (
    <nav class="settings-nav" aria-label="Settings categories">
      <div
        class="settings-nav__list"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
      >
        {SETTINGS_CATEGORIES.map((category, index) => {
          const isActive = category.id === activeCategory.value;
          return (
            <button
              key={category.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              id={categoryTabId(category.id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={SECTION_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              class={`settings-nav__item ${isActive ? "is-active" : ""}`}
              // `title` survives the icon's removal (2026-08-19, DL-11.3
              // retired): at compact width the label truncates, and the
              // tooltip is what still says the whole name. `aria-label` is
              // gone with the icon — the label text IS the accessible name
              // now, and a duplicate that says the same thing is one more
              // string to keep in sync for nothing.
              title={category.label}
              onClick={() => selectCategory(index)}
            >
              <span class="settings-nav__label">{category.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
