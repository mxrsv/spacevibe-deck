import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";
import { FORCE_CLASS } from "../force-states";

/** The layout of the small-UI section: a labelled grid whose cells carry one forced state each. */

export type State = "rest" | "hover" | "focus" | "pressed" | "selected" | "disabled" | "invalid";

const FORCE: Partial<Record<State, string>> = {
  hover: FORCE_CLASS.hover,
  focus: FORCE_CLASS.focus,
  pressed: FORCE_CLASS.active,
};

/** A cell of the grid: the node, and the state the cell is forced into. */
export interface Cell {
  readonly state: State;
  readonly node: ComponentChildren;
}

export interface Row {
  readonly label: string;
  readonly cells: readonly (Cell | null)[];
}

export function Grid({
  columns,
  rows,
  first = "5.5rem",
}: {
  columns: readonly string[];
  rows: readonly Row[];
  first?: string;
}) {
  return (
    <div
      className="grid items-center gap-x-2 gap-y-1.5"
      style={{ gridTemplateColumns: `${first} repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      <span />
      {columns.map((column) => (
        <span key={column} className="text-center text-xs text-muted-foreground">
          {column}
        </span>
      ))}
      {rows.map((row) => (
        <>
          <span key={row.label} className="text-xs text-muted-foreground">
            {row.label}
          </span>
          {row.cells.map((cell, index) => (
            <div
              key={columns[index]}
              className={cn(
                "flex min-h-9 items-center justify-center",
                cell !== null && FORCE[cell.state],
              )}
            >
              {cell?.node}
            </div>
          ))}
        </>
      ))}
    </div>
  );
}

export const Group = ({ name, children }: { name: string; children: ComponentChildren }) => (
  <section className="flex flex-col gap-2.5">
    <h2 className="text-xs font-medium text-muted-foreground">{name}</h2>
    {children}
  </section>
);
