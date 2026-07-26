import type { AgentAttentionSummary } from "../terminal/tabs-store";
import { WorkspaceSpinner } from "./workspace-spinner";

interface AgentAttentionMarkProps {
  /** Aggregated attention state for one tab/workspace. */
  summary: AgentAttentionSummary;
  /** Workspace/tab name — feeds the accessible name. */
  label: string;
  /** Invoked when an ACTIONABLE mark is clicked. */
  onActivate?: () => void;
}

/** Kinds whose count/color come from `summary.actionableCount`. */
type ActionableKind = "error" | "warning" | "requested" | "completed";

const ACTIONABLE_WORD: Record<ActionableKind, string> = {
  error: "error",
  warning: "warning",
  requested: "requested",
  completed: "completed",
};

function isActionableKind(
  kind: AgentAttentionSummary["kind"],
): kind is ActionableKind {
  return kind in ACTIONABLE_WORD;
}

/** "2 need attention (error)" — the part that is not the workspace label. */
function actionableState(kind: ActionableKind, count: number): string {
  const verb = count === 1 ? "needs attention" : "need attention";
  return `${count} ${verb} (${ACTIONABLE_WORD[kind]})`;
}

function actionableAriaLabel(
  label: string,
  kind: ActionableKind,
  count: number,
): string {
  return `${label}: ${actionableState(kind, count)}`;
}

/**
 * Shared status mark for a tab/workspace's Agent Attention Rail state.
 * Renders by precedence, driven entirely by `summary.kind` (already the
 * highest-precedence state across the tab's panes — see AgentAttentionSummary):
 *   actionable (error/warning/requested/completed) → an interactive dot
 *   working                                        → a spinner status
 *   unread                                          → a dot status
 *   idle                                            → nothing
 * Only the actionable mark is interactive; working/unread are decoration.
 *
 * Actionable and unread share one dot shape in a semantic color — the count is
 * carried by the accessible name and the tooltip, never painted on screen: a
 * count badge over a 20px workspace logo swamps the avatar it annotates.
 *
 * `title` deliberately omits the workspace label that `aria-label` carries.
 * Once a button has an aria-label, `title` demotes to the accessible
 * *description*, which NVDA and VoiceOver read right after the name — the same
 * string twice. The tooltip only has to add what the pointer context lacks.
 */
export function AgentAttentionMark({
  summary,
  label,
  onActivate,
}: AgentAttentionMarkProps) {
  const { kind } = summary;

  if (isActionableKind(kind)) {
    return (
      <button
        type="button"
        class={`attn-mark attn-mark--${kind}`}
        aria-label={actionableAriaLabel(label, kind, summary.actionableCount)}
        title={actionableState(kind, summary.actionableCount)}
        onClick={() => onActivate?.()}
      >
        <span class="attn-mark__dot" aria-hidden="true" />
      </button>
    );
  }

  if (kind === "working") {
    return (
      <span
        class="attn-mark attn-mark--working"
        role="status"
        aria-label={`${label}: agent working`}
      >
        <WorkspaceSpinner />
      </span>
    );
  }

  if (kind === "unread") {
    return (
      <span
        class="attn-mark attn-mark--unread"
        role="status"
        aria-label={`${label}: unread output`}
      >
        <span class="attn-mark__dot" aria-hidden="true" />
      </span>
    );
  }

  return null;
}

export type { AgentAttentionMarkProps };
