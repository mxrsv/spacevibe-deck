import { useEffect } from "preact/hooks";
import { DeckIcon, RAIL_ICON } from "./controls/deck-icon";
import { isUnavailable, unavailableReason, type ToolbarItem } from "./toolbar/toolbar-item";
import {
  useDismiss,
  useStageOverlayFlag,
  useSurfacePlacement,
  type AnchorRect,
} from "./worktree-card-menus";

/**
 * The collapsed rail's tools (DL-28.6): the six icons of the expanded row as
 * rows of a DL-13 popover, each with its chord, standing beside the column
 * because the column is too narrow for six side by side.
 *
 * It borrows `ToolbarOverflowMenu`'s row (DL-23.5's shape: icon · name · chord,
 * and an unavailable row keeps its place and prints its reason, DL-23.6) and
 * the avatar flyout's plumbing: `useSurfacePlacement` to sit beside the trigger,
 * `useDismiss` for Esc and an outside press, `useStageOverlayFlag` so the
 * native browser view steps aside while it is up.
 */

interface RailToolsMenuProps {
  readonly items: readonly ToolbarItem[];
  /** The `Tools` button's rect, measured when the menu opened. */
  readonly rect: AnchorRect;
  /** The button — its own press toggles, so it must not close us through the dismiss path too. */
  readonly trigger: HTMLElement;
  /** `restoreFocus` is false when the press already moved focus somewhere on purpose. */
  onClose(restoreFocus: boolean): void;
}

/** Where an arrow key moves from `current`, wrapping like `ToolbarOverflowMenu`. */
function rowTarget(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function RailToolsMenu({ items, rect, trigger, onClose }: RailToolsMenuProps) {
  const { ref, style, placed } = useSurfacePlacement(rect, "right");
  // Esc returns focus to the button, which DL-28.6 asks for; an outside press
  // does too only while focus was still inside the menu.
  useDismiss(
    () => {
      onClose(ref.current?.contains(document.activeElement) === true);
    },
    ref,
    trigger,
  );
  useStageOverlayFlag();

  const rows = (): HTMLButtonElement[] => Array.from(ref.current?.querySelectorAll("button") ?? []);

  // Hidden until measured, and a hidden element cannot take focus: so the first
  // row is focused once placed, which is what makes Enter on the button land here.
  useEffect(() => {
    if (placed) {
      rows()[0]?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  return (
    <div
      ref={ref}
      class="toolbar-menu rail-tools-menu"
      role="menu"
      aria-label="Tools"
      style={style}
      onKeyDown={(event) => {
        const all = rows();
        const target = rowTarget(
          event.key,
          all.indexOf(document.activeElement as HTMLButtonElement),
          all.length,
        );
        if (target !== null) {
          event.preventDefault();
          all[target]?.focus();
        }
      }}
    >
      {items.map((item) => {
        const reason = unavailableReason(item);
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            class={`toolbar-menu__row ${reason !== null ? "is-unavailable" : ""}`}
            aria-disabled={isUnavailable(item)}
            onClick={() => {
              if (isUnavailable(item)) {
                return;
              }
              // A chosen row opens something and hands it focus, so the button
              // must not take it back.
              onClose(false);
              item.onActivate();
            }}
          >
            <DeckIcon icon={item.icon} size={RAIL_ICON} />
            <span class="toolbar-menu__label">{item.label}</span>
            {reason === null ? (
              item.shortcut !== null && <kbd class="toolbar-menu__kbd">{item.shortcut}</kbd>
            ) : (
              <span class="toolbar-menu__reason">{reason}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
