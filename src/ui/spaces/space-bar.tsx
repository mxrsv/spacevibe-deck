import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { tildify } from "../../lib/process-info";
import { useStageOverlayFlag, useSurfacePlacement } from "../worktree-card-menus";
import { needsTone, runsByWorkspace, spaceCounts, spaceLabel, type Space } from "./space-model";
import { SpaceMini } from "./space-mini";

/**
 * The terminal half of the strip (DL-35.3): the current space's folder, then
 * one mark per space in strip order. Documents and the browser keep their own
 * chips after it (DL-18.10). A mark says where, never what the agent said —
 * that stays with the rail.
 */

/** DL-13.7's open delay, the rail strip's own figure. */
const CARD_OPEN_MS = 120;
/** Room kept beside the current mark when the row scrolls to it (DL-35.3). */
const SCROLL_MARGIN = 12;

export interface SpaceBarProps {
  readonly spaces: readonly Space[];
  readonly home: string;
  /** Owner key of the mark whose context menu is open, for `aria-expanded`. */
  readonly menuKey: number | null;
  readonly onGo: (space: Space) => void;
  readonly onMenu: (space: Space, trigger: HTMLElement, x: number, y: number) => void;
}

interface Hover {
  readonly key: number;
  readonly rect: DOMRect;
}

function SpaceCard({ space, rect, home }: { space: Space; rect: DOMRect; home: string }) {
  const { ref, style } = useSurfacePlacement(rect, "below");
  useStageOverlayFlag();
  return createPortal(
    <div ref={ref} id={`space-card-${space.key}`} class="space-card" role="tooltip" style={style}>
      <SpaceMini panes={space.panes} class="space-card__mini" />
      <span class="space-card__text">
        <span class="space-card__name">
          {space.folder}
          {space.index !== null && <span class="space-card__index">{space.index}</span>}
        </span>
        {space.path !== null && <span class="space-card__path">{tildify(space.path, home)}</span>}
        <span class="space-card__meta">
          {space.branch === null ? spaceCounts(space) : `${space.branch} · ${spaceCounts(space)}`}
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

export function SpaceBar({ spaces, home, menuKey, onGo, onMenu }: SpaceBarProps) {
  const row = useRef<HTMLDivElement>(null);
  const card = useHoverCard();
  /**
   * A press focuses the mark before its click switches the space; the card is
   * for keyboard focus and hover, not a flash under the pointer — and while it
   * is up the browser's native view steps aside (`useStageOverlayFlag`).
   */
  const pressing = useRef(false);
  const current = spaces.find((space) => space.current);
  const hovered = spaces.find((space) => space.key === card.hover?.key);

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
          the cell holds the longest name and the marks never shift. */}
      <span class="space-bar__name">
        {spaces.map((space) => (
          <span
            key={space.key}
            class="space-bar__name-slot"
            data-current={space.current ? "true" : undefined}
            aria-hidden={space.current ? undefined : "true"}
          >
            {space.folder}
          </span>
        ))}
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
        <SpaceCard space={hovered} rect={card.hover.rect} home={home} />
      )}
    </div>
  );
}
