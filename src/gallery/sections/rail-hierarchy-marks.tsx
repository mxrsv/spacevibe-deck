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

/** The four statuses a folded workspace speaks with, loudest first (RH-10). */
const ATTENTION: readonly { readonly status: RailStatus; readonly words: string }[] = [
  { status: "needs-input", words: "need you" },
  { status: "failed", words: "failed" },
  { status: "unread", words: "unread" },
  { status: "working", words: "working" },
];

/** At most this many clusters show; the agents of the rest fold into `+N`. */
const MAX_CLUSTERS = 3;

export function FoldedCluster({ agents }: { readonly agents: readonly MockAgent[] }) {
  const present = ATTENTION.map((kind) => ({
    ...kind,
    count: agents.filter((agent) => agent.status === kind.status).length,
  })).filter((kind) => kind.count > 0);
  const shown = present.slice(0, MAX_CLUSTERS);
  const hidden = present.slice(MAX_CLUSTERS).reduce((sum, kind) => sum + kind.count, 0);
  if (present.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={present.map((kind) => `${kind.count} ${kind.words}`).join(", ")}
      className="rh-cluster"
    >
      {shown.map((kind) => (
        <span key={kind.status} className="rh-cluster__item">
          <HierarchyMark status={kind.status} />
          {kind.count}
        </span>
      ))}
      {hidden > 0 ? <span className="rh-cluster__more">+{hidden}</span> : null}
    </span>
  );
}
