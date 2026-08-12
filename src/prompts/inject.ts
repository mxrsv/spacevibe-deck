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

/** Result of one atomic, per-pane Prompt Board injection attempt. */
export type InjectOutcome =
  | "sent"
  | "pasted"
  | "failed"
  | "busy"
  | "no-target";

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
export function submitAllowed({
  expectedAgent,
  info,
  attention,
  alive,
}: SubmitGateInput): boolean {
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
