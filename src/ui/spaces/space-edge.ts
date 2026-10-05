import { useLayoutEffect, useState } from "preact/hooks";

/** A horizontal extent: a client rect reduced to what the edge test reads. */
export interface Span {
  readonly left: number;
  readonly right: number;
}

/** The colour of what waits out of sight on each side; null when nothing does. */
export interface EdgeNeeds {
  readonly left: "red" | null;
  readonly right: "red" | null;
}

const NOTHING: EdgeNeeds = { left: null, right: null };

/**
 * Which side of a scrolled strip hides a needs-you mark (DL-35.3). A mark is
 * hidden once its centre is out of the frame, since its dot is the centre.
 * Red only, whichever tone is hidden: the marks themselves took a second ink
 * for a question (DL-35.3, owner 2026-10-06) and the edge dot has not followed
 * them. Takes rects, not elements, because jsdom has no layout to measure.
 */
export function hiddenNeeds(frame: Span, needsYou: readonly Span[]): EdgeNeeds {
  const centres = needsYou.map((mark) => (mark.left + mark.right) / 2);
  return {
    left: centres.some((centre) => centre < frame.left) ? "red" : null,
    right: centres.some((centre) => centre > frame.right) ? "red" : null,
  };
}

/**
 * `hiddenNeeds` over a live row, re-measured when it scrolls or resizes, and
 * when `layoutKey` changes (marks added, or a mark's need appearing).
 */
export function useEdgeNeeds(
  row: { readonly current: HTMLElement | null },
  layoutKey: string,
): EdgeNeeds {
  const [edge, setEdge] = useState<EdgeNeeds>(NOTHING);
  useLayoutEffect(() => {
    const list = row.current;
    if (list === null) return;
    const measure = (): void => {
      const marks = list.querySelectorAll(".space-mark[data-needs]");
      const next = hiddenNeeds(
        list.getBoundingClientRect(),
        [...marks].map((mark) => mark.getBoundingClientRect()),
      );
      setEdge((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [row, layoutKey]);
  return edge;
}
