import { useEffect, useRef } from "preact/hooks";
import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";
import { groupToolbarItems } from "./toolbar-overflow";
import {
  isUnavailable,
  unavailableReason,
  type ToolbarItem,
} from "./toolbar-item";

/**
 * Where the actions the bar could not fit go.
 *
 * It is a popover made of rows (DL-13.1, DL-13.3), not a second toolbar: an
 * action that overflows keeps its icon, its label, its chord and its state,
 * and gains the words the bar had no room for. Group order survives the move —
 * the hairline between groups is the same boundary the bar draws vertically.
 */

/** Viewport coordinates: the menu hangs from the trigger's bottom-right. */
export interface MenuAnchor {
  readonly right: number;
  readonly top: number;
}

interface OverflowMenuProps {
  readonly items: readonly ToolbarItem[];
  readonly anchor: MenuAnchor;
  /** The `More` button — its own click toggles, so it must not close us too. */
  readonly triggerEl: HTMLElement | null;
  readonly onClose: () => void;
}

export function ToolbarOverflowMenu({
  items,
  anchor,
  triggerEl,
  onClose,
}: OverflowMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // `role="menu"` promises arrow-key movement, so the promise is kept here:
  // focus lands on the first row when the menu opens, arrows move it with
  // wraparound, Home/End jump. Unavailable rows stay in the cycle — they are
  // focusable on purpose, so their reason is reachable without a pointer.
  const rows = (): HTMLButtonElement[] =>
    Array.from(rootRef.current?.querySelectorAll("button") ?? []);

  useEffect(() => {
    rows()[0]?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) !== true &&
        triggerEl?.contains(target) !== true
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const all = rows();
      if (all.length === 0) {
        return;
      }
      event.preventDefault();
      const current = all.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? all.length - 1
            : event.key === "ArrowDown"
              ? (current + 1) % all.length
              : current <= 0
                ? all.length - 1
                : current - 1;
      all[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [triggerEl, onClose]);

  return (
    <div
      ref={rootRef}
      class="toolbar-menu"
      role="menu"
      aria-label="More actions"
      style={{ right: `${anchor.right}px`, top: `${anchor.top}px` }}
    >
      {groupToolbarItems(items).map((view, index) => (
        <div key={view.group} class="toolbar-menu__group">
          {index > 0 && <span class="toolbar-menu__sep" aria-hidden="true" />}
          {view.items.map((item) => {
            const reason = unavailableReason(item);
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                class={`toolbar-menu__row ${
                  item.state.kind === "active" ? "is-active" : ""
                } ${reason !== null ? "is-unavailable" : ""}`}
                aria-disabled={isUnavailable(item)}
                onClick={() => {
                  if (isUnavailable(item)) {
                    return;
                  }
                  item.onActivate();
                  onClose();
                }}
              >
                {/* DL-23.9: `RAIL_ICON`, not the popover's usual `ROW_ICON` —
                    the row's label went one rung up the ladder and a 14px
                    glyph beside 14px text stops reading as the leading mark. */}
                <DeckIcon icon={item.icon} size={RAIL_ICON} />
                <span class="toolbar-menu__label">{item.label}</span>
                {reason === null ? (
                  item.shortcut !== null && (
                    <kbd class="toolbar-menu__kbd">{item.shortcut}</kbd>
                  )
                ) : (
                  <span class="toolbar-menu__reason">{reason}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
