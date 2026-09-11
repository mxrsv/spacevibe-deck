/**
 * Turns a resolved session reference into the exact command line typed into a
 * restored pane's shell. Pure — no host imports here on purpose: the facade
 * that calls the main process (`src/host/resume-host.ts`) is a separate
 * module so this builder stays unit-testable without a fake bridge.
 */
import type { CustomAgent } from "./agent-catalog";
import type { ResumeForms } from "./agents/agent-definition";
import { ACTIVE_AGENTS } from "./agents/agent-registry";

/** Wire mirror of `electron/resume/resolve.ts`'s `ResumeRef` — see that file. */
export type ResumeRef =
  { readonly kind: "id"; readonly id: string } | { readonly kind: "latest" } | null;

/** Wire mirror of `electron/resume/resolve.ts`'s `ResumeRequest`. */
export interface ResumeRequest {
  readonly agent: string;
  readonly cwd: string | null;
  readonly lastSeenAt: number;
  /**
   * The session this pane is paired with — the tail path's remembered
   * pairing, or (since stage 1, 2026-09-03) a FACT from the Claude registry
   * that restore sends too, so `resume_lookup` reopens the recorded
   * conversation rather than the nearest one by mtime.
   */
  readonly preferredId?: string;
  /**
   * `preferredId` is a fact, not a memory: answer it or answer nothing, never
   * rank a substitute (spec §10.7). Only the tail path sends it.
   */
  readonly exact?: boolean;
}

/** Wire mirror of `electron/resume/session-tail.ts`'s `SessionTailAnswer`. */
export interface SessionTailAnswer {
  readonly id: string;
  readonly tail: string | null;
  /** The model the newest recorded turn ran on, or null when the transcript names none. */
  readonly model: string | null;
}

/**
 * A session id from a CLI's own state dir is untrusted input scanned off
 * disk; it must match this before it may reach a PTY write.
 */
const SESSION_REF_SAFE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * One entry per active built-in, from each agent's own file
 * (`agents/agent-registry.ts`). A withdrawn agent has no entry, so a pane
 * journaled under it restores as a plain shell. A Map rather than an object
 * literal, so an agent string like `constructor` cannot reach an inherited
 * property.
 */
const COMMAND_TABLE: ReadonlyMap<string, ResumeForms> = new Map(
  ACTIVE_AGENTS.map((agent) => [agent.id, agent.resume] as const),
);

/**
 * Command typed into the restored pane's shell.
 * - built-in + id ref → the CLI's exact-resume form
 * - built-in + latest ref → the CLI's continue form
 * - built-in + null ref → the bare agent command (fresh session, best-effort)
 * - custom agent (matched by LABEL — classification stores labels for
 *   declared agents) → its declared command, ref ignored (no resume support)
 * - unknown agent string → null (pane stays a plain shell)
 * An id failing SESSION_REF_SAFE degrades to the null-ref branch — an
 * untrusted state-dir string must never reach a PTY write.
 */
export function buildResumeCommand(
  agent: string,
  ref: ResumeRef,
  customAgents: readonly CustomAgent[],
): string | null {
  const custom = customAgents.find((entry) => entry.label === agent);
  if (custom !== undefined) {
    return custom.command;
  }
  const forms = COMMAND_TABLE.get(agent);
  if (forms === undefined) {
    return null;
  }
  if (ref === null) {
    return forms.bare;
  }
  if (ref.kind === "latest") {
    return forms.latest;
  }
  if (!SESSION_REF_SAFE.test(ref.id)) {
    return forms.bare;
  }
  return forms.id(ref.id);
}
