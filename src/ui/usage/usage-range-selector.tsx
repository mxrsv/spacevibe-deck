import { useRef } from "preact/hooks";
import { activeUsageRange } from "./active-usage-view-store";
import { USAGE_RANGES } from "./usage-ranges";

/**
 * The period the display figure covers (DL-16.7) — the only control this
 * screen has, and the only one it is allowed.
 *
 * Segmented rather than a §6 `cycle` pill on purpose: every period is visible
 * at once because the set of available comparisons is itself information, and
 * a cycle would turn "go back one period" into three clicks through states
 * nobody asked for. DL-16.7 records that argument so it is not re-litigated
 * as a §6 violation.
 *
 * `role="tablist"` with roving arrow keys, the `settings-nav.tsx` idiom (R5),
 * horizontal here so the arrows match the axis the options are laid out on.
 * Escape is deliberately not handled: the screen owns it, and swallowing it
 * would strand a reader whose focus happens to be on this control.
 *
 * Selection writes a module signal that is never persisted (see
 * `active-usage-view-store.ts`).
 */
export function UsageRangeSelector() {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectRange = (index: number): void => {
    activeUsageRange.value = USAGE_RANGES[index].id;
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    let step: 1 | -1;
    if (event.key === "ArrowRight") {
      step = 1;
    } else if (event.key === "ArrowLeft") {
      step = -1;
    } else {
      return;
    }
    event.preventDefault();
    const length = USAGE_RANGES.length;
    const currentIndex = USAGE_RANGES.findIndex(
      (range) => range.id === activeUsageRange.value,
    );
    const from = currentIndex === -1 ? 0 : currentIndex;
    selectRange((from + step + length) % length);
  };

  return (
    <div
      class="usage-range"
      role="tablist"
      aria-label="Cost range"
      onKeyDown={handleKeyDown}
    >
      {USAGE_RANGES.map((range, index) => {
        const isActive = range.id === activeUsageRange.value;
        return (
          <button
            key={range.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            class={`usage-range__option ${isActive ? "is-active" : ""}`}
            onClick={() => selectRange(index)}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
