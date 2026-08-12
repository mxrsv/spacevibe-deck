import { useEffect, useRef } from "preact/hooks";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
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
      }
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
                <DeckIcon icon={item.icon} size={ROW_ICON} />
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
