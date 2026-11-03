import type { JSX } from "preact";
import { cn } from "@/lib/cn";
import { withRef } from "../controls/with-ref";

/** How a pressed cell reads: the strip's selection mark, or a toggle's fill. */
export type StripCellMark = "underline" | "fill";

const CELL =
  "relative flex h-full min-w-9 shrink-0 items-center justify-center px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40 aria-pressed:text-foreground";

const MARK: Readonly<Record<StripCellMark, string>> = {
  underline:
    "aria-pressed:after:absolute aria-pressed:after:inset-x-0 aria-pressed:after:bottom-0 aria-pressed:after:h-0.5 aria-pressed:after:bg-primary",
  fill: "aria-pressed:bg-muted",
};

/**
 * One flush cell of the dock's strip and breadcrumb row. A cell is as tall as its row and has no
 * margin or radius, so its hover and pressed fill run edge to edge and the row carries no padding
 * of its own (the `Button` variants are boxes with their own inset and cannot do that).
 */
export const StripCell = withRef(function StripCell({
  className,
  mark = "underline",
  ...props
}: JSX.HTMLAttributes<HTMLButtonElement> & {
  readonly disabled?: boolean;
  readonly mark?: StripCellMark;
}) {
  return (
    // raw-control: a flush cell as tall as its row; no Button variant fills the row edge to edge
    <button type="button" {...props} className={cn(CELL, MARK[mark], className)} />
  );
});
