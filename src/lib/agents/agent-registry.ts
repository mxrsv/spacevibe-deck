/**
 * Every built-in agent Deck knows, in order. This list is the ONE place an
 * agent is added, withdrawn or removed — the catalog, the discovery probe,
 * process classification, resume, the runtime and launch-flag controls and
 * the tab-dot colours all derive from it (`docs/internals/terminal.md`).
 *
 * Imports only this directory: the main process compiles it too.
 */
import type { AgentDefinition } from "./agent-definition";
import { AGY } from "./agy";
import { CLAUDE } from "./claude";
import { CODEX } from "./codex";
import { CURSOR_AGENT } from "./cursor-agent";
import { GEMINI } from "./gemini";
import { OPENCODE } from "./opencode";

/**
 * Order is reach, not history, and it is a contract: it decides the chip order
 * and the digit key that opens each agent in AgentQuickPicker and the Open
 * board. Append a new agent LAST so every existing key keeps the agent it
 * opened — and know that withdrawing one moves every agent after it up a key.
 */
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  CLAUDE,
  CODEX,
  OPENCODE,
  AGY,
  GEMINI,
  CURSOR_AGENT,
];

/** The agents Deck probes, lists, classifies and resumes: every one not withdrawn. */
export const ACTIVE_AGENTS: readonly AgentDefinition[] = AGENT_DEFINITIONS.filter(
  (agent) => agent.withdrawn !== true,
);

export const ACTIVE_AGENT_IDS: readonly string[] = ACTIVE_AGENTS.map((agent) => agent.id);
