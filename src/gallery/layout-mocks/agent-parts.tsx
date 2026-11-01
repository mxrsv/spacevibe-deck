import { cn } from "@/lib/cn";
import { AgentStateMark as SharedStateMark } from "../../ui/blocks/agent-state-mark";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import type { RailStatus } from "../../ui/rail-view-model";
import type { AgentKind, Confidence, MockState } from "./layout-fixture";

/** The mock's state words in the app's `RailStatus` vocabulary. */
const RAIL_STATUS: Readonly<Record<MockState, RailStatus>> = {
  failed: "failed",
  "needs-you": "needs-input",
  unchecked: "unread",
  ended: "ended",
  working: "working",
  done: "done",
  idle: "idle",
};

/** The shared state mark, fed from the mock's fixture. */
export function AgentStateMark({
  state,
  confidence,
  className,
}: {
  readonly state: MockState;
  readonly confidence?: Confidence;
  readonly className?: string;
}) {
  return (
    <SharedStateMark status={RAIL_STATUS[state]} confidence={confidence} className={className} />
  );
}

/** The agent's brand mark in Deck's own logo set; size it with `className`. */
export function AgentLogo({
  kind,
  className,
}: {
  readonly kind: AgentKind;
  readonly className?: string;
}) {
  return <AgentGlyph agent={kind} className={cn("size-4 shrink-0", className)} />;
}

/** macOS window controls, drawn inset the way Deck's hidden title bar places them. */
export function TrafficLights({ className }: { readonly className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center gap-2", className)}>
      <span className="size-3 rounded-full bg-[#ff5f57]" />
      <span className="size-3 rounded-full bg-[#febc2e]" />
      <span className="size-3 rounded-full bg-[#28c840]" />
    </div>
  );
}
