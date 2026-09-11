import type { ContractSignal } from "./agent-attention";

export interface CodexLifecycle {
  /** SessionStart is idle before the first turn is submitted. */
  readonly turnId: string | null;
  readonly completed: boolean;
  readonly retiredTurns: readonly string[];
}

const RETIRED_TURN_LIMIT = 64;

/** Null refuses an old event; lifecycle authority lasts until another turn or process. */
export function advanceCodexTurn(
  current: CodexLifecycle | null,
  signal: ContractSignal,
): CodexLifecycle | null {
  const turnId = signal.turnId;
  if (!turnId || current?.retiredTurns.includes(turnId)) return null;
  if (current?.turnId != null && current.turnId !== turnId && signal.kind !== "working")
    return null;
  if (current?.turnId === turnId && current.completed && signal.kind !== "completed") return null;
  return {
    turnId,
    completed: signal.kind === "completed" || signal.kind === "interrupted",
    retiredTurns:
      current?.turnId != null && current.turnId !== turnId
        ? [...current.retiredTurns, current.turnId].slice(-RETIRED_TURN_LIMIT)
        : (current?.retiredTurns ?? []),
  };
}
