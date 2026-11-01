import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Button } from "../../../../ui/controls/button";
import { Kbd } from "../../../../ui/controls/kbd";
import { AgentLogo, AgentStateMark } from "../../agent-parts";
import {
  AGENT_NAME,
  STATE_LABEL,
  agentById,
  placeOf,
  type MockAgent,
  type TermLine,
} from "../../layout-fixture";
import { MockTerminal } from "../../mock-terminal";
import type { Review } from "./diff-data";

function TerminalPane({ agent, review }: { readonly agent: MockAgent; readonly review: Review }) {
  const pasted: readonly TermLine[] = review.sent.value
    .filter((item) => item.target.agent.id === agent.id)
    .flatMap((item): TermLine[] => [
      [],
      [
        ["accent", "> "],
        ["fg", item.payload],
      ],
    ]);
  return (
    <section
      aria-label={`${AGENT_NAME[agent.kind]}, ${STATE_LABEL[agent.state]}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l first:border-l-0"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs">
        <AgentLogo kind={agent.kind} className="size-3.5" />
        <span className="shrink-0 font-medium text-foreground">{AGENT_NAME[agent.kind]}</span>
        <AgentStateMark state={agent.state} confidence={agent.confidence} />
      </header>
      <MockTerminal lines={[...agent.terminal, ...pasted]} className="flex-1" />
    </section>
  );
}

/**
 * Stage-level placements (b, c): the diff view takes the stage; one key (Esc, after the composer
 * has been discarded, DLC13) returns to the space's terminals, and a button brings the diff back.
 */
export function DiffStageShell({
  agent,
  review,
  label,
  onClose,
  children,
}: {
  readonly agent: MockAgent;
  readonly review: Review;
  readonly label: string;
  /** Set by a shell that owns the way back; Esc and ⌘⇧H then leave the diff through it. */
  readonly onClose?: () => void;
  readonly children: ComponentChildren;
}) {
  const showDiff = useSignal(true);
  const { space } = placeOf(agent);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showDiff.value) {
        event.preventDefault();
        if (review.composing.value) review.discard();
        else if (onClose) onClose();
        else showDiff.value = false;
      } else if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        if (onClose) onClose();
        else showDiff.value = !showDiff.value;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Signals and the review's methods read current values.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (showDiff.value) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-view="diff">
        {children}
        <span hidden data-return-key="Escape" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-view="terminals">
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs text-muted-foreground">{review.notice.value}</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            showDiff.value = true;
          }}
        >
          {label}
          <Kbd>⌘⇧H</Kbd>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        {space.paneIds.map((id) => (
          <TerminalPane key={id} agent={agentById(id)} review={review} />
        ))}
      </div>
    </div>
  );
}
