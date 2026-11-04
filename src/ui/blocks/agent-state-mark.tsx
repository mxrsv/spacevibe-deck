import { cn } from "@/lib/cn";
import type { SignalConfidence } from "../../terminal/agent-attention";
import type { RailStatus } from "../rail-view-model";
import { BrailleSpinner } from "./braille-spinner";

/**
 * The agent state mark (RCP-15, DL-27.3), one drawing per `RailStatus` so the rail, the strip,
 * the pane header and the dock say a state the same way. A 14 slot whose geometry never moves
 * between states: a 9 dot in a status token, a 15 ring round the needs-you dot, a 7 square for
 * ended, and the braille spinner for working. An inferred needs-you, unread or done is drawn
 * hollow. `32-state-mark.css` draws it.
 */
export function AgentStateMark({
  status,
  confidence = "explicit",
  className,
}: {
  readonly status: RailStatus;
  readonly confidence?: SignalConfidence;
  /** Layout only. */
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-state={status}
      data-confidence={confidence}
      className={cn("state-mark", className)}
    >
      {status === "working" ? <BrailleSpinner /> : null}
    </span>
  );
}
