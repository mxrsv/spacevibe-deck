import type { JSX } from "preact";
import { cn } from "@/lib/cn";
import { STATE_DISABLED, STATE_IDLE, STATE_MOTION } from "../blocks/recipe-classes";
import { withRef } from "../controls/with-ref";

/** How a pressed cell reads: the strip's selection mark, or a toggle's fill. */
export type StripCellMark = "underline" | "fill";

/** RCP-9: hover and keyboard focus are one wash, pressed lays its layer, disabled is 50%. */
const CELL = `relative flex h-full min-w-9 shrink-0 items-center justify-center px-2 text-xs text-(--text-muted) hover:text-(--text-primary) focus-visible:text-(--text-primary) aria-pressed:text-(--text-primary) ${STATE_MOTION} ${STATE_IDLE} ${STATE_DISABLED}`;

/** The selected cell: the strip's full wash (DL-21.1), or a toggle's. */
const MARK: Readonly<Record<StripCellMark, string>> = {
  underline: "aria-pressed:bg-(--tab-active-bg)",
  fill: "aria-pressed:bg-(--tab-active-bg)",
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
