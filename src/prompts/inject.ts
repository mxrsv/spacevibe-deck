import type { PaneProcessInfo } from "../lib/process-info";
import type { AgentProcessMatcher } from "../lib/agent-catalog";
import type { PaneAttentionSnapshot } from "../terminal/agent-attention";
import { freshPaneInfo } from "../terminal/pane-info";
import { defaultPtyClient, type PtyClient } from "../terminal/pty-client";

/**
 * What the popover captured when it opened. Every later step — scan, paste,
 * submit — uses this snapshot's `paneId`, never "whatever is active now": the
 * user picked a template for the pane they were looking at.
 */
export interface PromptTarget {
  readonly paneId: number;
  /** The agent the pane ran at capture time; null = bare shell (paste only). */
  readonly agent: string | null;
  readonly cwd: string | null;
}

/**
 * Result of one atomic, per-pane Prompt Board injection attempt.
 *
 * `stale` is only given when the caller asked for the process check (`expectedProcessId`): the
 * agent process that was there when the request was gated is gone, so nothing is submitted. The
 * process is read before the paste as well as before Enter, so the text is in the pane only when
 * the process changed between the two.
 *
 * `expired` is only given when the caller set `pasteDeadline` and it passed before the paste:
 * nothing was typed.
 */
export type InjectOutcome =
  "sent" | "pasted" | "failed" | "busy" | "no-target" | "stale" | "expired";

/** What one injection is asked to do; the two optional fields exist for the in-pane `deck` command. */
export interface InjectOptions {
  readonly autoSend: boolean;
  readonly expectedAgent: string | null;
  /**
   * Wait this long after the paste before reading the submit gate, so the gate looks at the pane
   * as it is just before Enter and not as it was at the paste (diff-line-comments spec DLC10).
   * Absent = read it at once, as every older caller does.
   */
  readonly submitDelayMs?: number;
  /**
   * The agent process the request was gated on. With it, the fresh `pty_info` read before Enter
   * must name the same process, or the outcome is `stale` and Enter is withheld. Absent = the
   * agent name alone decides, as for every older caller.
   */
  readonly expectedProcessId?: number;
  /**
   * Epoch milliseconds after which nothing is typed (the outcome is `expired`), checked right
   * before the paste and so after the process read above. The call this injection answers has
   * already given up. Absent = no bound, as for every older caller.
   */
  readonly pasteDeadline?: number;
  /**
   * Epoch milliseconds after which Enter is withheld (the outcome is `pasted`): the call this
   * injection answers has already given up. Absent = no bound, as for every older caller.
   */
  readonly submitDeadline?: number;
}

export interface SubmitGateInput {
  /** The agent captured when the popover opened. */
  readonly expectedAgent: string | null;
  /** Fresh `pty_info` for the target pane — undefined when it was not reported. */
  readonly info: PaneProcessInfo | undefined;
  /** Attention snapshot for the target pane, from the tracker. */
  readonly attention: PaneAttentionSnapshot | null;
  /** Whether the pane is still in some tab's layout. */
  readonly alive: boolean;
}

/**
 * The triple gate (spec §7). Read immediately before `\r` is enqueued, never
 * at popover-open time — the whole point is that state can change in between.
 *
 * 1. the pane still runs the SAME agent it ran at capture;
 * 2. it is idle with nothing latched — a `working` pane, or one carrying a
 *    `requested`/`warning`/`error` latch, may be showing a dialog whose
 *    highlighted option Enter would accept;
 * 3. it is still in the layout.
 *
 * `completed` passes: it is the latch a finished run leaves behind, which is
 * exactly the moment a follow-up prompt is wanted.
 *
 * Residual risk, accepted and documented in the spec: a TUI dialog that emits
 * no OSC signal is invisible to gate 2. Per-template `autoSend` is the user's
 * choice made in that knowledge.
 */
export function submitAllowed({ expectedAgent, info, attention, alive }: SubmitGateInput): boolean {
  if (!alive) {
    return false;
  }
  if (expectedAgent === null || info === undefined) {
    return false;
  }
  if (info.kind !== "agent" || info.agent !== expectedAgent) {
    return false;
  }
  if (attention === null || attention.phase !== "idle") {
    return false;
  }
  return attention.attention === "none" || attention.attention === "completed";
}

/**
 * Snapshot the focused pane. Fresh `pty_info`, not the 2s poll cache: the user
 * may have started or quit an agent since the last tick, and the captured
 * agent is what gate 1 later compares against.
 */
export async function capturePromptTarget(
  activePaneId: number | null,
  pty: PtyClient = defaultPtyClient,
  agentMatchers: readonly AgentProcessMatcher[] = [],
): Promise<PromptTarget | null> {
  if (activePaneId === null) {
    return null;
  }
  const [info] = await freshPaneInfo([activePaneId], pty, agentMatchers);
  return {
    paneId: activePaneId,
    agent: info?.kind === "agent" ? info.agent : null,
    cwd: info?.cwd ?? null,
  };
}
