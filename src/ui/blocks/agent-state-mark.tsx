import { cn } from "@/lib/cn";
import type { SignalConfidence } from "../../terminal/agent-attention";
import type { RailStatus } from "../rail-view-model";

/**
 * The agent state mark of the redesigned shell (layout mock), one drawing per `RailStatus` so
 * the rail, the dock and the stage say a state the same way. A fixed 10px box: geometry never
 * moves between states. Only `working` (a turning ring) and `needs-input` (one ripple) move,
 * and only while they hold. An inferred `needs-input`, `unread` or `done` is drawn hollow.
 * The colours are the mock's; they move onto theme tokens when a region cuts over.
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
  const hollow = confidence === "inferred" && status !== "failed" && status !== "working";
  return (
    <span
      aria-hidden="true"
      data-state={status}
      className={cn(
        "relative inline-flex size-2.5 shrink-0 items-center justify-center",
        className,
      )}
    >
      {status === "working" ? (
        <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-foreground/25 border-t-foreground motion-reduce:animate-none" />
      ) : status === "ended" ? (
        <span className="size-[7px] rounded-[1.5px] bg-muted-foreground" />
      ) : status === "idle" ? null : (
        <>
          {status === "needs-input" ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-500/60 motion-reduce:hidden dark:bg-amber-400/50" />
          ) : null}
          <span
            className={cn(
              "relative size-2 rounded-full",
              status === "failed" && "bg-red-600 dark:bg-red-500",
              status === "needs-input" &&
                (hollow
                  ? "border-[1.5px] border-amber-500 dark:border-amber-400"
                  : "bg-amber-500 dark:bg-amber-400"),
              status === "unread" &&
                (hollow
                  ? "border-[1.5px] border-sky-600 dark:border-sky-400"
                  : "bg-sky-600 dark:bg-sky-400"),
              status === "done" &&
                (hollow ? "border-[1.5px] border-muted-foreground" : "bg-muted-foreground"),
            )}
          />
        </>
      )}
    </span>
  );
}
