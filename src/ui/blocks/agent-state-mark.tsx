import { cn } from "@/lib/cn";
import type { SignalConfidence } from "../../terminal/agent-attention";
import type { RailStatus } from "../rail-view-model";
import { BrailleSpinner } from "./braille-spinner";

/** The surfaces that keep a mark; each sizes its box through a token (`--mark-size-<surface>`). */
export type StateMarkSurface = "pill" | "pane";

/**
 * The agent state mark (SR-7, DL-27.3), one drawing per `RailStatus` so every surface that keeps
 * a mark says a state the same way: the stage bar's pill and the pane header. The project rail
 * draws none (SR-3). Working is the braille spinner, needs-input a solid dot with a radiating
 * ring, unread a smaller solid dot, done a solid disc with a check cut out of it, failed a cross,
 * ended a small square and idle a short dash. An inferred state is the same shape at 55% ink,
 * never hollow. `32-state-mark.css` draws it, sized by the surface's token.
 */
export function AgentStateMark({
  status,
  confidence = "explicit",
  surface,
  className,
}: {
  readonly status: RailStatus;
  readonly confidence?: SignalConfidence;
  /** Which surface's size token the box takes; the default is `--mark-size`. */
  readonly surface?: StateMarkSurface;
  /** Layout only. */
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-state={status}
      data-confidence={confidence}
      data-surface={surface}
      className={cn("state-mark", className)}
    >
      {status === "working" ? <BrailleSpinner /> : null}
    </span>
  );
}
