import type { TreePane } from "@protocol/tree";

export type MarkKind = "needsYou" | "working" | "done" | "failed" | "idle";

/** The rail's state mark for a pane: attention outranks phase, as on the desktop. */
export function markKind(pane: TreePane): MarkKind {
  if (pane.attention === "requested" || pane.attention === "warning") return "needsYou";
  if (pane.attention === "error") return "failed";
  if (pane.phase === "working") return "working";
  if (pane.attention === "completed") return "done";
  return "idle";
}

export const MARK_TEXT: Record<MarkKind, string> = {
  needsYou: "Needs you",
  working: "Working",
  done: "Done",
  failed: "Failed",
  idle: "Idle",
};

export function paneName(pane: TreePane): string {
  return pane.agentLabel ?? (pane.title === "" ? "Terminal" : pane.title);
}

export function agentSymbol(agent: string | null): "sparkle" | "terminal" {
  return agent === null ? "terminal" : "sparkle";
}

/** When the pane last did something a person cares about, for the row's age. */
export function paneTime(pane: TreePane): number | null {
  return pane.lastOutputAt ?? pane.attentionSince;
}
