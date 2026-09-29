import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useStageOverlayFlag, useSurfacePlacement } from "../worktree-card-menus";
import {
  needsTone,
  runsByWorkspace,
  spaceAddress,
  spaceCounts,
  spaceLabel,
  type Space,
} from "./space-model";
import { SpaceRenameField } from "./space-rename-field";

/**
 * The terminal half of the strip (DL-35.3): the current space's name (its
 * folder while unnamed), then one mark per space in strip order. Documents and
 * the browser keep their own chips after it (DL-18.10). A mark says where,
 * never what the agent said — that stays with the rail. A double-click on the
 * name renames the space in place.
 */

/**
 * DL-35.3's open delay (owner, 2026-09-29): long enough that a pointer passing
 * over the marks on its way somewhere else raises nothing.
 */
const CARD_OPEN_MS = 600;
/** Room kept beside the current mark when the row scrolls to it (DL-35.3). */
const SCROLL_MARGIN = 12;

export interface SpaceBarProps {
  readonly spaces: readonly Space[];
  /** Owner key of the mark whose context menu is open, for `aria-expanded`. */
  readonly menuKey: number | null;
  readonly onGo: (space: Space) => void;
  readonly onMenu: (space: Space, trigger: HTMLElement, x: number, y: number) => void;
  /** Name the space, or clear its name with `null`. */
  readonly onRename: (space: Space, name: string | null) => void;
}

interface Hover {
  readonly key: number;
  readonly rect: DOMRect;
}

/** Name and counts only (owner, 2026-09-29): the miniature and path were noise at a glance. */
function SpaceCard({ space, rect }: { space: Space; rect: DOMRect }) {
  const { ref, style } = useSurfacePlacement(rect, "below");
  useStageOverlayFlag();
  return createPortal(
    <div ref={ref} id={`space-card-${space.key}`} class="space-card" role="tooltip" style={style}>
      <span class="space-card__text">
        <span class="space-card__name">
          {space.name ?? space.folder}
          {space.name === null && space.index !== null && (
            <span class="space-card__index">{space.index}</span>
          )}
        </span>
        <span class="space-card__meta">
          {[space.name === null ? null : spaceAddress(space), space.branch, spaceCounts(space)]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
      </span>
    </div>,
    document.body,
  );
}

function useHoverCard(): {
  readonly hover: Hover | null;
  readonly show: (key: number, mark: HTMLElement, delay: number) => void;
  readonly hide: () => void;
} {
  const [hover, setHover] = useState<Hover | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    hover,
    show: (key, mark, delay) => {
      cancel();
      const raise = (): void => setHover({ key, rect: mark.getBoundingClientRect() });
      if (delay === 0) raise();
      else timer.current = setTimeout(raise, delay);
    },
    hide: () => {
      cancel();
      setHover(null);
    },
  };
}

export function SpaceBar({ spaces, menuKey, onGo, onMenu, onRename }: SpaceBarProps) {
  const row = useRef<HTMLDivElement>(null);
  const card = useHoverCard();
  /** Owner key of the space whose name is being edited, if any. */
  const [editingKey, setEditingKey] = useState<number | null>(null);
  /**
   * A press focuses the mark before its click switches the space; the card is
   * for keyboard focus and hover, not a flash under the pointer — and while it
   * is up the browser's native view steps aside (`useStageOverlayFlag`).
   */
  const pressing = useRef(false);
  const current = spaces.find((space) => space.current);
  const hovered = spaces.find((space) => space.key === card.hover?.key);

  // A switch made behind the field (attention navigation, a closed tab) takes
  // its space out from under it; the edit ends there, not when it returns.
  useEffect(() => {
    if (editingKey !== null && current?.key !== editingKey) setEditingKey(null);
  }, [current?.key, editingKey]);

  // Keep the current mark in view when the row scrolls (DL-35.3). Horizontal
  // only: `scrollIntoView` would scroll `#root` too (traps.md).
  useLayoutEffect(() => {
    const list = row.current;
    const mark = list?.querySelector<HTMLElement>('.space-mark[aria-selected="true"]');
    if (!list || !mark) return;
    const frame = list.getBoundingClientRect();
    const box = mark.getBoundingClientRect();
    if (box.left < frame.left) list.scrollLeft -= frame.left - box.left + SCROLL_MARGIN;
    else if (box.right > frame.right) list.scrollLeft += box.right - frame.right + SCROLL_MARGIN;
  }, [current?.key]);

  return (
    <div class="space-bar">
      {/* Every name shares one grid cell and only the current one shows, so
          the cell holds the longest name and the marks never shift — the
          rename field floats over the cell rather than resizing it. */}
      <span class="space-bar__name">
        {spaces.map((space) => {
          const editing = space.current && editingKey === space.key;
          return (
            <span
              key={space.key}
              class="space-bar__name-slot"
              data-current={space.current ? "true" : undefined}
              data-editing={editing ? "true" : undefined}
              aria-hidden={space.current ? undefined : "true"}
              onDblClick={space.current ? () => setEditingKey(space.key) : undefined}
            >
              <span class="space-bar__label">{spaceLabel(space)}</span>
              {editing && (
                <SpaceRenameField
                  class="space-bar__rename"
                  initial={space.name ?? ""}
                  placeholder={spaceAddress(space)}
                  onCommit={(name) => {
                    setEditingKey(null);
                    onRename(space, name);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              )}
            </span>
          );
        })}
      </span>
      <div
        ref={row}
        class="space-bar__marks"
        role="tablist"
        aria-label="Spaces"
        onScroll={card.hide}
      >
        {runsByWorkspace(spaces).map((run) => (
          <span key={run[0].key} class="space-bar__run">
            {run.map((space) => (
              <button
                type="button"
                key={space.key}
                role="tab"
                class="space-mark"
                data-space-key={space.key}
                aria-selected={space.current}
                aria-label={`${spaceLabel(space)} · ${spaceCounts(space)}`}
                aria-describedby={
                  hovered?.key === space.key ? `space-card-${space.key}` : undefined
                }
                aria-haspopup="menu"
                aria-expanded={menuKey === space.key}
                data-needs={needsTone(space) ?? undefined}
                onMouseEnter={(event) => card.show(space.key, event.currentTarget, CARD_OPEN_MS)}
                onMouseLeave={() => {
                  // A press released off the mark never fires `pointerup` here.
                  pressing.current = false;
                  card.hide();
                }}
                onPointerDown={() => {
                  pressing.current = true;
                }}
                onPointerUp={() => {
                  pressing.current = false;
                }}
                onPointerCancel={() => {
                  // A touch press that became a scroll of the row ends here.
                  pressing.current = false;
                }}
                onFocus={(event) => {
                  if (!pressing.current) card.show(space.key, event.currentTarget, 0);
                }}
                onBlur={card.hide}
                onClick={() => {
                  card.hide();
                  onGo(space);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  card.hide();
                  onMenu(space, event.currentTarget, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    event.stopPropagation();
                    card.hide();
                    const rect = event.currentTarget.getBoundingClientRect();
                    onMenu(space, event.currentTarget, rect.left, rect.bottom);
                  }
                }}
              >
                <span class="space-mark__pill" aria-hidden="true" />
              </button>
            ))}
          </span>
        ))}
      </div>
      {hovered !== undefined && card.hover !== null && (
        <SpaceCard space={hovered} rect={card.hover.rect} />
      )}
    </div>
  );
}
