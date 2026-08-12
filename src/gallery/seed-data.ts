import type { Preset } from "../lib/preset-schema";
import type { SerializedNode } from "../lib/split-tree";
import type {
  AgentAttentionSummary,
  StatusInfo,
  TabView,
} from "../terminal/tabs-store";

/**
 * Canned state the chrome specimens render against.
 *
 * Chosen to cover the states a screenshot of the running app rarely shows all
 * at once: a renamed tab beside a process-derived one, every attention kind,
 * an unread tab, and a split layout deep enough for the preset thumbnail to
 * have something to draw. Nothing here is loaded from disk — the gallery is
 * not allowed to read or write the user's real stores.
 */

const HOME = "/Users/deck";

export const SEED_HOME = HOME;

function attention(
  kind: AgentAttentionSummary["kind"],
  counts: Partial<Omit<AgentAttentionSummary, "kind">> = {},
): AgentAttentionSummary {
  return {
    kind,
    actionableCount: counts.actionableCount ?? 0,
    workingCount: counts.workingCount ?? 0,
    unreadCount: counts.unreadCount ?? 0,
  };
}

export const SEED_TABS: readonly TabView[] = [
  {
    key: 1,
    process: "claude",
    name: null,
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-deck`,
    agentBusy: true,
    unread: false,
    attention: attention("working", { workingCount: 1 }),
  },
  {
    key: 2,
    process: "codex",
    name: "review",
    dotColor: "magenta",
    workspacePath: `${HOME}/spacevibe-api`,
    agentBusy: true,
    unread: true,
    attention: attention("requested", { actionableCount: 1 }),
  },
  {
    key: 3,
    process: "agy",
    name: null,
    dotColor: null,
    workspacePath: `${HOME}/spacevibe-hub`,
    agentBusy: true,
    unread: false,
    attention: attention("error", { actionableCount: 2 }),
  },
  {
    key: 4,
    process: "zsh",
    name: null,
    dotColor: "green",
    workspacePath: `${HOME}/scratch`,
    agentBusy: false,
    unread: false,
    attention: attention("idle"),
  },
];

export const SEED_STATUS: StatusInfo = {
  branch: "main",
  cwd: `${HOME}/spacevibe-deck`,
  agent: "claude",
  paneCount: 3,
  home: HOME,
};

/** Every kind the attention mark can render, in the rail's own severity order. */
export const SEED_ATTENTION: readonly AgentAttentionSummary[] = [
  attention("error", { actionableCount: 2 }),
  attention("warning", { actionableCount: 1 }),
  attention("requested", { actionableCount: 1 }),
  attention("completed", { actionableCount: 3 }),
  attention("working", { workingCount: 2 }),
  attention("unread", { unreadCount: 4 }),
  attention("idle"),
];

const SPLIT_LAYOUT: SerializedNode = {
  type: "split",
  direction: "row",
  ratio: 0.62,
  first: { type: "leaf" },
  second: {
    type: "split",
    direction: "column",
    ratio: 0.5,
    first: { type: "leaf" },
    second: { type: "leaf" },
  },
};

export const SEED_PRESETS: readonly Preset[] = [
  { id: "single", name: "Single", layout: { type: "leaf" } },
  { id: "agent-plus-shell", name: "Agent + shell", layout: SPLIT_LAYOUT },
];

export const SEED_LAYOUT = SPLIT_LAYOUT;
