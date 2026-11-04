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
import { buildResumeCommand, type ResumeRef } from "../lib/agent-resume";
import { noteResumedPane } from "../terminal/session-tail-store";
import { countAgentLaunch } from "../telemetry/usage-counters";
import { catalogLaunchCommand, type CustomAgent } from "../lib/agent-catalog";
import { applyResumeFlags } from "../lib/launch-command";
import { BUILT_IN_PRESET } from "../lib/preset-schema";
import type { SessionEntry } from "../lib/session-history";
import type { RememberedPane } from "../lib/session-schema";
import type { resumeLookup } from "../host/resume-host";
import { lookupRememberedRef } from "../terminal/session-restore";
import type { MaterializeIntent } from "../terminal/tab-materialize";

export interface ResumeSessionDeps {
  materialize(intent: MaterializeIntent): Promise<boolean>;
  readonly customAgents: readonly CustomAgent[];
  /** True when the session's recorded cwd no longer exists on disk. */
  isDead(cwd: string): boolean;
}

/** One pane to resume from a resolver answer (`resume_lookup`'s `ResumeRef`). */
export interface ResumeTarget {
  readonly agent: string;
  readonly cwd: string;
  /** The project the tab belongs to; the rail's tail request is keyed on it. */
  readonly workspacePath: string;
  /** An exact id or `latest`; null is not an answer and is refused. */
  readonly ref: ResumeRef;
  /** The pane's own recorded command, so a Claude pane keeps its flags. */
  readonly launchCommand?: string | null;
}

/**
 * Resume one pane from a resolver answer. Same refusals as a history row:
 * a dead cwd, no answer, or an id that did not survive into the command all
 * return false without spawning. `latest` has no id to check, so it only needs
 * a command to exist (the resolver offers it for the agents whose table allows).
 */
export async function resumeFromRef(
  target: ResumeTarget,
  deps: ResumeSessionDeps,
): Promise<boolean> {
  // Checked BEFORE spawn: Deck must not inherit the silent
  // dead-cwd-lands-in-$HOME behaviour here. Resuming a conversation in the
  // wrong directory is worse than not resuming it (spec §4).
  if (deps.isDead(target.cwd) || target.ref === null) {
    return false;
  }
  const built = buildResumeCommand(target.agent, target.ref, deps.customAgents);
  // `buildResumeCommand` degrades an unsafe id to the BARE agent command. A
  // bare `claude` here would silently open a NEW conversation while the user
  // asked to resume an old one, so this path refuses instead. The empty id is
  // its own clause: it also fails `SESSION_REF_SAFE`, but every string
  // `.includes("")`, so the survived-into-the-command test cannot see it.
  if (built === null) {
    return false;
  }
  if (target.ref.kind === "id" && (target.ref.id === "" || !built.includes(target.ref.id))) {
    return false;
  }
  const command = applyResumeFlags(built, target.launchCommand ?? null);
  const opened = await deps.materialize({
    layout: BUILT_IN_PRESET.layout,
    cwds: [target.cwd],
    paneCommands: [command],
    workspacePath: target.workspacePath,
  });
  // The rail's turn line, same reason as session restore (2026-08-17): this
  // pane continues an existing conversation, so the session already on disk is
  // its own and the tail store's never-ran rule must not hide it. Marked only
  // once the tab exists — an intent that failed leaves no pane to claim it.
  if (opened) {
    noteResumedPane(target.workspacePath, target.agent);
    // Usage analytics (spec §4): a resumed agent is a launch. Counted here
    // rather than in `materialize`, which sees only the pane command and
    // deliberately not this agent id.
    countAgentLaunch(target.agent);
  }
  return opened;
}

export function resumeSession(entry: SessionEntry, deps: ResumeSessionDeps): Promise<boolean> {
  return resumeFromRef(
    {
      agent: entry.agent,
      cwd: entry.cwd,
      workspacePath: entry.cwd,
      ref: { kind: "id", id: entry.sessionId },
    },
    deps,
  );
}

export interface RememberedResumeDeps extends ResumeSessionDeps {
  readonly lookup: typeof resumeLookup;
}

/**
 * What pressing a remembered row did.
 * - `resumed`: the conversation's resume command was typed into one new pane.
 * - `fresh`: the resolver found nothing. Nothing was opened; the caller starts
 *   the agent in `entry.cwd` with `command` and says it started fresh. `command`
 *   is the pane's recorded launch command, else the agent's default, else null
 *   when nothing declares the agent any more.
 * - `failed`: nothing was opened and starting fresh would be wrong or
 *   impossible — the directory is gone, the resolver's id is unsafe, or the tab
 *   did not open.
 */
export type RememberedResume =
  | { readonly status: "resumed" }
  | { readonly status: "fresh"; readonly command: string | null }
  | { readonly status: "failed"; readonly reason: "cwd-missing" | "not-resumed" };

export async function resumeRememberedPane(
  entry: RememberedPane,
  deps: RememberedResumeDeps,
): Promise<RememberedResume> {
  if (deps.isDead(entry.cwd) || deps.isDead(entry.workspacePath)) {
    return { status: "failed", reason: "cwd-missing" };
  }
  const ref = await lookupRememberedRef(deps.lookup, entry);
  if (ref === null) {
    return {
      status: "fresh",
      command:
        entry.launchCommand ??
        catalogLaunchCommand(entry.agent, deps.customAgents) ??
        // A pane's agent is a custom agent's LABEL, which the catalog's id lookup misses.
        deps.customAgents.find((custom) => custom.label === entry.agent)?.command ??
        null,
    };
  }
  const resumed = await resumeFromRef({ ...entry, ref }, deps);
  return resumed ? { status: "resumed" } : { status: "failed", reason: "not-resumed" };
}
