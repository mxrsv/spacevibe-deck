/**
 * Fixtures for the attention list's tests and its gallery section: panes, tabs
 * and a repository scan wired through the real `buildAgentRail`, so both drive
 * the same projection the chip reads instead of a hand-built stream that could
 * drift from it. The clock is the fixed `NOW`, so ages are the same every time.
 */
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { buildAgentRail, type AgentRailInput } from "./agent-rail-model";
import { buildAttentionList, type AttentionEntry } from "./attention-list-model";

export const MINUTE = 60_000;
/** A round clock, so every `changedAt` in a fixture reads as "now minus X". */
export const NOW = 1_700_000_000_000;

const IDLE = {
  kind: "idle",
  actionableCount: 0,
  workingCount: 0,
  unreadCount: 0,
} as const;

export function pane(paneId: number, over: Partial<PaneView> = {}): PaneView {
  return {
    paneId,
    agent: "claude",
    attention: "none",
    phase: "idle",
    // The default fixture pane has run and been checked: `done`.
    hasRun: true,
    changedAt: NOW - MINUTE,
    ...over,
  };
}

export function tab(
  key: number,
  workspacePath: string | null,
  over: Partial<TabView> = {},
): TabView {
  return {
    key,
    process: "zsh",
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: IDLE,
    ...over,
  };
}

export function repo(
  key: string,
  worktrees: readonly { path: string; branch?: string }[],
): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path,
      head: "0".repeat(40),
      branch: entry.branch ?? null,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  };
}

export const DECK = repo("/w/deck/.git", [
  { path: "/w/deck", branch: "main" },
  { path: "/w/deck-side", branch: "release-hardening" },
]);

export const SCANS = new Map<string, RepositoryScan>([
  ["/w/deck", DECK],
  ["/w/deck-side", DECK],
]);

export function list(tabs: readonly TabView[], over: Partial<AgentRailInput> = {}) {
  return buildAttentionList(
    buildAgentRail({
      tabs,
      activeIndex: 0,
      scans: SCANS,
      workspaceHistoryPaths: ["/w/deck", "/w/deck-side"],
      now: NOW,
      ...over,
    }),
  );
}

/** The pane ids of a list, in the order it prints them. */
export function ids(entries: readonly AttentionEntry[]): number[] {
  return entries.map((entry) => entry.paneId);
}
