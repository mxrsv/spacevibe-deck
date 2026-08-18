import { useEffect, useState } from 'preact/hooks';

/**
 * The tooltip an icon-only control needs to be legible (DL-14.4).
 *
 * A native `title` was doing this job and cannot keep doing it: it never
 * appears on keyboard focus, its delay and placement belong to the OS, and it
 * cannot lay a name and a chord out as two columns. This one is a chrome
 * surface like any other — tokens, one hairline, the 0.13s chrome state
 * transition (DL-7), no shadow and no blur (DL-1.3).
 *
 * Positioned `fixed` off the trigger's rect rather than absolutely inside it:
 * the bar it lives in is a 33px row that clips, and a tooltip that renders
 * inside that row is a tooltip nobody can read.
 *
 * See docs/specs/2026-08-12-feature-toolbar-design.md. There is no numbered DL
 * rule for tooltips yet — adding one is a design-language fork and belongs to
 * the pass that puts this toolbar into the shipping chrome.
 */

/** Viewport coordinates of the tooltip's top-centre point. */
export interface TooltipAnchor {
  readonly left: number;
  readonly top: number;
}

/** Below the trigger, centred on it, and never off the side of the window. */
const TOOLTIP_OFFSET = 6;
const TOOLTIP_EDGE_MARGIN = 90;

export function tooltipAnchor(element: HTMLElement): TooltipAnchor {
  const rect = element.getBoundingClientRect();
  const centre = rect.left + rect.width / 2;
  const limit = Math.max(TOOLTIP_EDGE_MARGIN, window.innerWidth - TOOLTIP_EDGE_MARGIN);
  return {
    left: Math.min(Math.max(centre, TOOLTIP_EDGE_MARGIN), limit),
    top: rect.bottom + TOOLTIP_OFFSET,
  };
}

/**
 * Pointer and keyboard both open it, and it stays open while either still
 * holds — hovering away from a focused control must not hide the description
 * the focus is what asked for.
 */
export function useTooltipVisibility(): {
  readonly anchor: TooltipAnchor | null;
  readonly open: (element: HTMLElement) => void;
  readonly close: () => void;
} {
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);

  useEffect(() => {
    if (anchor === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setAnchor(null);
      }
    };
    // The anchor is a viewport coordinate; anything that moves the window
    // moves the trigger out from under it.
    const onWindowChange = (): void => setAnchor(null);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onWindowChange);
    };
  }, [anchor]);

  return {
    anchor,
    open: (element: HTMLElement) => setAnchor(tooltipAnchor(element)),
    close: () => setAnchor(null),
  };
}

interface ActionTooltipProps {
  /** Referenced by the trigger's `aria-describedby` while it is shown. */
  readonly id: string;
  readonly label: string;
  /** Formatted for the active platform, or `null` when it has no binding. */
  readonly shortcut: string | null;
  /** Why the action cannot run — replaces the chord, which would not work either. */
  readonly reason: string | null;
  readonly anchor: TooltipAnchor;
}

export function ActionTooltip({ id, label, shortcut, reason, anchor }: ActionTooltipProps) {
  return (
    <div
      id={id}
      class="action-tip"
      role="tooltip"
      style={{ left: `${anchor.left}px`, top: `${anchor.top}px` }}
    >
      <span class="action-tip__line">
        <span class="action-tip__label">{label}</span>
        {reason === null && shortcut !== null && <kbd class="action-tip__kbd">{shortcut}</kbd>}
      </span>
      {reason !== null && <span class="action-tip__reason">{reason}</span>}
    </div>
  );
}
