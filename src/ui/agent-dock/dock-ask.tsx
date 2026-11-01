import { Button } from "../controls/button";
import { selectRailItem, type RailSelection } from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";

export interface DockAskProps {
  /** The focused agent's row, or null when none holds the keyboard. */
  readonly item: RailItem | null;
  readonly selection: RailSelection;
}

/**
 * What the focused agent is waiting on (LAY-6), at the top of the dock and only while its status is
 * Needs input. Display only: there is no reply channel and nothing is written to a terminal. The one
 * control takes the keyboard back to that agent's pane through the focus path the rail uses, where
 * the answer is typed.
 */
export function DockAsk({ item, selection }: DockAskProps) {
  if (item === null || item.status !== "needs-input" || item.entry.kind !== "agent") {
    return null;
  }
  const detail = item.entry.detail?.trim() ?? "";
  const waiting = item.confidence === "inferred" ? "Probably waiting for you" : "Waiting for you";
  return (
    <section aria-label="Ask" className="border-b px-3 py-2">
      <div className="rounded-md border border-(--term-warn)/50 bg-muted p-2">
        <p className="font-mono text-code text-foreground">{detail === "" ? waiting : detail}</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => selectRailItem(item, selection)}
        >
          Open pane
        </Button>
      </div>
    </section>
  );
}
