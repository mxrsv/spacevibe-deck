import { cn } from "@/lib/cn";
import { BrailleSpinner } from "../../ui/blocks/braille-spinner";
import type { RailStatus } from "../../ui/rail-view-model";
import type { MockAgent } from "./rail-hierarchy-data";
import "./rail-hierarchy-section.css";

/**
 * The proposed state mark (ledger RH-2, RH-3): a 12 slot, an 8 glyph, one shape per status and
 * no hollow ring. The shapes live in `rail-hierarchy-section.css`; at build time they replace
 * `32-state-mark.css` and `AgentStateMark` itself, so this is a drawing of the target, not a
 * second component.
 */
export function HierarchyMark({
  status,
  className,
}: {
  readonly status: RailStatus;
  readonly className?: string;
}) {
  return (
    <span aria-hidden="true" data-state={status} className={cn("rh-mark", className)}>
      {status === "working" ? <BrailleSpinner /> : null}
    </span>
  );
}

/** What a folded workspace speaks with (owner, 2026-11-06): unread and pending (working) only. */
const FOLDED_KINDS: readonly { readonly status: RailStatus; readonly words: string }[] = [
  { status: "unread", words: "unread" },
  { status: "working", words: "working" },
];

/** One filled circle per status present, in that status's own colour. */
export function FoldedCircles({ agents }: { readonly agents: readonly MockAgent[] }) {
  const present = FOLDED_KINDS.map((kind) => ({
    ...kind,
    count: agents.filter((agent) => agent.status === kind.status).length,
  })).filter((kind) => kind.count > 0);
  if (present.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={present.map((kind) => `${kind.count} ${kind.words}`).join(", ")}
      className="rh-circles"
    >
      {present.map((kind) => (
        <span key={kind.status} data-state={kind.status} className="rh-circle">
          {kind.count}
        </span>
      ))}
    </span>
  );
}

/** The agent count as a small circle on the logo's corner. */
export function CountBadge({ count }: { readonly count: number }) {
  return (
    <span className="rh-badge" aria-label={`${count} sessions`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}
