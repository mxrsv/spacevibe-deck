import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";

/** At or under this much left, the ring turns destructive: the limit is what to look at now. */
const LOW_REMAINING_PERCENT = 20;

/**
 * How much of a limit is left, as a small ring around whatever the caller puts in its centre
 * (an agent's logo). `null` means no reading: an empty track, never a made-up number. The ring
 * is decorative; the control holding it carries the name and the exact figure in its tooltip.
 */
export function UsageRing({
  remaining,
  children,
  className,
}: {
  /** Percent left, 0-100, or `null` without a current reading. */
  readonly remaining: number | null;
  readonly children?: ComponentChildren;
  /** Layout only. */
  readonly className?: string;
}) {
  const left = remaining === null ? null : Math.min(100, Math.max(0, remaining));
  return (
    <span
      aria-hidden="true"
      data-low={left !== null && left <= LOW_REMAINING_PERCENT ? "" : undefined}
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center text-foreground data-low:text-destructive",
        className,
      )}
    >
      <svg viewBox="0 0 20 20" fill="none" className="absolute inset-0 size-full -rotate-90">
        <circle cx="10" cy="10" r="9" stroke-width="2" stroke="currentColor" opacity="0.18" />
        {left === null ? null : (
          <circle
            data-slot="usage-ring-value"
            cx="10"
            cy="10"
            r="9"
            stroke-width="2"
            stroke-linecap="round"
            stroke="currentColor"
            pathLength={100}
            stroke-dasharray={`${left} 100`}
          />
        )}
      </svg>
      {children}
    </span>
  );
}
