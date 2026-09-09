/**
 * The command Restart types into a pane whose agent has left (spec §5.6,
 * §11.10). Pure, and separate from `tab-manager.ts` for the reason
 * `agent-resume.ts` is separate from the resume facade: the composition is
 * worth asserting without building a `TabManager`.
 */
import { buildResumeCommand, type ResumeRef } from "../lib/agent-resume";
import { applyResumeFlags } from "../lib/launch-command";
// `CustomAgent` lives in `lib/agent-catalog`. `settings-schema.ts` IMPORTS it
// (`:7`) and never re-exports it, so the obvious-looking path does not compile;
// `lib/agent-resume.ts:7` — the module this one composes — takes it from the
// catalog for the same reason.
import type { CustomAgent } from "../lib/agent-catalog";

export interface RestartInput {
  /** The agent that was running — `PaneView.lastAgent`, not the live one. */
  readonly agent: string;
  /** The session the tail store confirmed for this pane, or null. */
  readonly sessionId: string | null;
  /** The command this pane launched with, flags included, or null. */
  readonly launchCommand: string | null;
  readonly customAgents: readonly CustomAgent[];
}

/**
 * A composition of four things that already exist and were never composed:
 * the pane's confirmed session id, its launch command, the CLI's own resume
 * form, and the flag fold session restore uses.
 *
 * **A null session id asks for the LATEST session, never a bare relaunch.**
 * `buildResumeCommand` answers a null ref with `forms.bare`, which is the
 * fresh start the grilling refused (§17 Q4) — a Restart that quietly began a
 * new conversation would be a destructive act wearing a soft label.
 *
 * Null when the agent has no resume form at all: not a `COMMAND_TABLE` entry
 * and not a declared custom agent. The caller writes nothing rather than
 * guessing at a binary name.
 */
export function restartCommandFor(input: RestartInput): string | null {
  const ref: ResumeRef =
    input.sessionId === null ? { kind: "latest" } : { kind: "id", id: input.sessionId };
  const resume = buildResumeCommand(input.agent, ref, input.customAgents);
  if (resume === null) {
    return null;
  }
  return applyResumeFlags(resume, input.launchCommand);
}
