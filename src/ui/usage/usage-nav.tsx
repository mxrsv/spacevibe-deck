import { useRef } from "preact/hooks";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS, VIEW_PANEL_ID, viewTabId } from "./usage-views";

/**
 * The usage rail: a vertical list of view tabs. Click sets
 * `activeUsageView.value` directly — a module signal, no prop callback, the
 * same idiom as `settings-nav.tsx` (R5). `↑`/`↓` wrap with the local
 * roving-list formula `(index + step + length) % length` and move DOM focus
 * together with the signal, so the visibly-active item and the focused item
 * never disagree.
 *
 * `role="tablist"` / `role="tab"` — a rail selection swaps a single content
 * panel, which is the Tabs pattern, so vertical roving and `aria-selected`
 * are the correct semantics rather than an incidental choice.
 *
 * There is no foot. `settings-nav.tsx` pins Restore Defaults below a hairline
 * because a destructive action must not sit among navigable items (DL-11.5);
 * this screen has no destructive action, and the slot is not filled with
 * something else to make the two rails look alike.
 */
export function UsageNav() {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectView = (index: number): void => {
    activeUsageView.value = USAGE_VIEWS[index].id;
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
    const length = USAGE_VIEWS.length;
    const currentIndex = USAGE_VIEWS.findIndex(
      (view) => view.id === activeUsageView.value,
    );
    const from = currentIndex === -1 ? 0 : currentIndex;
    selectView((from + step + length) % length);
  };

  return (
    <nav class="usage-nav" aria-label="Token usage views">
      <div
        class="usage-nav__list"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
      >
        {USAGE_VIEWS.map((view, index) => {
          const isActive = view.id === activeUsageView.value;
          const Icon = view.Icon;
          return (
            <button
              key={view.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              id={viewTabId(view.id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={VIEW_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              class={`usage-nav__item ${isActive ? "is-active" : ""}`}
              onClick={() => selectView(index)}
            >
              <Icon />
              <span class="usage-nav__label">{view.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
