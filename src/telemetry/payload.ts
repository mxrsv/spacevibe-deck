/**
 * The usage-analytics payload contract — the ONE readable statement of what a
 * participating install sends, written for a person who is not a programmer.
 *
 * The behaviour around it is documented in docs/internals/telemetry.md. The
 * landing tour may `cat` this file on screen as a disclosure aid, so it must
 * keep reading as a contract. The snapshot test beside it is the privacy
 * contract in executable form: adding a field turns it red, and updating it
 * requires that page, the privacy page and its versioned archive to change in
 * the same release.
 *
 * Deliberately absent — and this list is the point of the file: a permanent
 * install identifier, file paths, repository names, branch names, file names,
 * terminal output, prompts, agent replies, hostname, username, locale,
 * timezone, and any per-action timestamp. `dailyId` is a fresh random UUID per
 * local day, never derived from hardware or from the previous day's id, so no
 * field links one day to the next.
 *
 * Sharing is ON by default (owner-decided 2026-08-23): no consent question
 * is asked (`USAGE_CONSENT_ASKED` is false), and it stops the moment "Share
 * usage stats" is switched off in Settings → Privacy — `declined` is the only
 * state never inferred away, and an unreadable `telemetry.json` fails closed
 * to off. The Tauri host sends nothing at all.
 */

import { isBuiltinAgentId } from "../lib/agent-catalog";

export const SCHEMA_VERSION = 1;

/**
 * The closed set of agent keys. A custom agent's name is a string the USER
 * typed, and this payload's whole premise is that it carries none — so every
 * custom agent folds into the single aggregate `"custom"` bucket before
 * anything leaves the renderer.
 */
export const AGENT_PAYLOAD_KEYS = [
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
  "cursor-agent",
  "custom",
] as const;

export type AgentPayloadKey = (typeof AGENT_PAYLOAD_KEYS)[number];

/** The three surfaces whose opens are counted. Opens, not time spent. */
export const SURFACE_KEYS = ["browser", "explorer", "usage"] as const;

export type SurfaceKey = (typeof SURFACE_KEYS)[number];

/**
 * One participating install-day, cumulative. Every send replaces the whole
 * row server-side, so a retry can never double-count.
 */
export interface UsagePayload {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** Fresh random UUID v4 for this local day; unrelated to every other day. */
  readonly dailyId: string;
  /** The client's LOCAL calendar day (YYYY-MM-DD), not a timestamp. */
  readonly day: string;
  /** The app version, e.g. "1.0.1". */
  readonly version: string;
  /** "darwin" | "win32". */
  readonly platform: string;
  /** "arm64" | "x64". */
  readonly arch: string;
  /** Agent launches that day, keyed by the closed set above. A launch, not a
   * conversation: resuming an agent at boot counts as a launch too. */
  readonly agents: Readonly<Partial<Record<AgentPayloadKey, number>>>;
  /** Times each surface went from not visible to visible that day. */
  readonly surfaces: Readonly<Record<SurfaceKey, number>>;
  /** The busiest single window's open-tab high-water mark that day. */
  readonly maxTabs: number;
  /** The busiest single window's open-pane high-water mark that day. */
  readonly maxPanes: number;
  /** True when boot restore materialized at least one pane that day. */
  readonly restoredSessions: boolean;
}

/** Folds any agent id to its payload key — a user-typed id becomes "custom". */
export function agentPayloadKey(id: string): AgentPayloadKey {
  return isBuiltinAgentId(id) ? (id as AgentPayloadKey) : "custom";
}
