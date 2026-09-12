/**
 * The usage-analytics payload contract — the ONE readable statement of what a
 * Deck install sends, written for a person who is not a programmer.
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
 * Release 1.1.0 is the first release that sends analytics. Sharing is always
 * on, with no opt-out (owner-decided 2026-09-06). No consent question is asked;
 * Settings → Privacy states exactly what is sent and has no switch. A stored
 * `declined` from a development build becomes `enabled` on launch, and main
 * refuses attempts to disable sharing. An unreadable `telemetry.json` does not
 * stop it either (2026-09-10): that run counts in memory and sends, and the
 * file is left untouched. Release 1.0.0 and the Tauri host send nothing at all.
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
 * What happened to Deck's own update checks that day, as plain counts. No
 * error message, no version number, no timing — only how many times each
 * step happened. It exists because a broken update feed is otherwise
 * invisible: a failed check leaves no trace outside the user's machine.
 *
 *  - `checked`: checks that got an answer (an update or none).
 *  - `checkFailed`: checks that got no answer at all.
 *  - `available`: answers that offered an update — checks, not distinct updates.
 *  - `downloaded` / `downloadFailed`: update downloads that finished or failed.
 *  - `installAttempted`: times Deck handed a downloaded update to the installer.
 */
export const UPDATE_KEYS = [
  "checked",
  "checkFailed",
  "available",
  "downloaded",
  "downloadFailed",
  "installAttempted",
] as const;

export type UpdateKey = (typeof UPDATE_KEYS)[number];

/**
 * One install-day, cumulative. Every send replaces the whole
 * row server-side, so a retry can never double-count.
 */
export interface UsagePayload {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** Fresh random UUID v4 for this local day; unrelated to every other day. */
  readonly dailyId: string;
  /** The client's LOCAL calendar day (YYYY-MM-DD), not a timestamp. */
  readonly day: string;
  /** The app version, e.g. "1.1.0". */
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
  /**
   * Update-check outcomes that day, every key present (see `UPDATE_KEYS`).
   * Added to schema 1 without a bump: releases up to 1.2.0 do not send it, and
   * the service accepts both shapes.
   */
  readonly updates: Readonly<Record<UpdateKey, number>>;
}

/**
 * Folds any agent id to its payload key. Only an active built-in that HAS a key
 * keeps it: a user-typed id, a withdrawn built-in and a built-in added after
 * the key set was fixed all become "custom" — a key outside the closed set is
 * exactly what the backend refuses.
 */
export function agentPayloadKey(id: string): AgentPayloadKey {
  const key = AGENT_PAYLOAD_KEYS.find((candidate) => candidate === id);
  return key !== undefined && isBuiltinAgentId(id) ? key : "custom";
}
