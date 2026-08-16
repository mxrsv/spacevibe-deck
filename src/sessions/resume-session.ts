/**
 * A history row's one action: open a single-pane tab in the session's own
 * directory and type that CLI's exact resume command.
 *
 * Two seams are reused rather than rebuilt, deliberately:
 * - `buildResumeCommand` is the ONE place a scanned session id is checked
 *   against `SESSION_REF_SAFE` before it can reach a PTY write. A second
 *   builder here would fork that check, which is a security boundary.
 * - `MaterializeIntent.paneCommands` already carries a per-pane command line
 *   (session restore, 2026-08-15). Nothing in tab materialization changes for
 *   this feature — it is a caller of an existing seam, not a widening of it.
 */
import { buildResumeCommand } from "../lib/agent-resume";
import type { CustomAgent } from "../lib/agent-catalog";
import { BUILT_IN_PRESET } from "../lib/preset-schema";
import type { SessionEntry } from "../lib/session-history";
import type { MaterializeIntent } from "../terminal/tab-materialize";

export interface ResumeSessionDeps {
  materialize(intent: MaterializeIntent): Promise<boolean>;
  readonly customAgents: readonly CustomAgent[];
  /** True when the session's recorded cwd no longer exists on disk. */
  isDead(cwd: string): boolean;
}

export async function resumeSession(
  entry: SessionEntry,
  deps: ResumeSessionDeps,
): Promise<boolean> {
  // Checked BEFORE spawn: Deck must not inherit the silent
  // dead-cwd-lands-in-$HOME behaviour here. Resuming a conversation in the
  // wrong directory is worse than not resuming it (spec §4).
  if (deps.isDead(entry.cwd)) {
    return false;
  }
  const command = buildResumeCommand(
    entry.agent,
    { kind: "id", id: entry.sessionId },
    deps.customAgents,
  );
  // `buildResumeCommand` degrades an unsafe id to the BARE agent command. A
  // bare `claude` here would silently open a NEW conversation while the user
  // asked to resume an old one, so this path refuses instead. The empty id is
  // its own clause: it also fails `SESSION_REF_SAFE`, but every string
  // `.includes("")`, so the survived-into-the-command test cannot see it.
  if (
    command === null ||
    entry.sessionId === "" ||
    !command.includes(entry.sessionId)
  ) {
    return false;
  }
  return deps.materialize({
    layout: BUILT_IN_PRESET.layout,
    cwds: [entry.cwd],
    paneCommands: [command],
    workspacePath: entry.cwd,
  });
}
