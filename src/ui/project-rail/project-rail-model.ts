/**
 * Pure helpers of the project-first rail's markup: what a row says in words, how a project
 * is initialled, and which host callback a row's press raises.
 */
import type { RailItem, RailStatus } from "../rail-view-model";

/**
 * DL-27.2: the mark is the fast read and never the only read, so every state also has a
 * word. `needs-input` says "needs you" as the shipped rail's `asked` does.
 */
const STATUS_WORD: Readonly<Record<RailStatus, string>> = {
  failed: "failed",
  "needs-input": "needs you",
  unread: "unread",
  ended: "ended",
  working: "working",
  done: "done",
  idle: "idle",
};

/** The states whose mark is drawn hollow when Deck inferred them (`AgentStateMark`). */
const INFERRABLE: ReadonlySet<RailStatus> = new Set(["needs-input", "unread", "done"]);

/**
 * `STATUS_WORD` plus what changes the meaning (DL-27.3): an inferred state is Deck's
 * reading of output timing, not the CLI's word, and a contract-layer detail says what an
 * agent that needs the user is waiting on.
 */
export function statusLabel(item: Pick<RailItem, "status" | "confidence" | "entry">): string {
  const word = STATUS_WORD[item.status];
  const detail = item.entry.kind === "agent" ? item.entry.detail : null;
  if (item.status === "needs-input" && typeof detail === "string" && detail !== "") {
    return `${word} — ${detail}`;
  }
  return item.confidence === "inferred" && INFERRABLE.has(item.status)
    ? `${word} (inferred)`
    : word;
}

/** Up to two initials of the project's name: `spacevibe-deck` is `SD`, `notes` is `N`. */
export function projectInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return initials === "" ? "?" : initials;
}

/** The two host callbacks a row can raise: the ones the shipped rail's rows call. */
export interface RailSelection {
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
}

/**
 * Select a row exactly as the shipped one does (`CardAgentRow`, `CardShellRow`): an agent
 * row focuses its pane, a shell-only row selects its tab.
 */
export function selectRailItem(item: Pick<RailItem, "entry">, selection: RailSelection): void {
  const { entry } = item;
  if (entry.kind === "agent") {
    selection.onFocusPane(entry.tabIndex, entry.paneId);
  } else {
    selection.onSelectTab(entry.tabIndex);
  }
}

/** The row that holds the window's keyboard: the focused pane, or the active shell tab. */
export function isRailItemFocused(item: Pick<RailItem, "entry">): boolean {
  const { entry } = item;
  return entry.kind === "agent" ? entry.focused : entry.active;
}
