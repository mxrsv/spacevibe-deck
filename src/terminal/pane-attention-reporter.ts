import type { PaneAttentionReport } from "../lib/pane-attention-report";
import type { PaneAttentionSnapshot } from "./agent-attention";

/**
 * Tells main what each pane's attention tracker says, for the in-pane `deck` command (spec
 * 2026-11-03-agent-orchestration, ORC17). `deck pane list` and `deck pane wait` answer from
 * main's copy, so a coordinator can wait on the same hook-backed state the rail draws.
 *
 * Called with every live pane after each view sync, which is every path that changes the
 * tracker. It sends a pane's report when something a caller can read changed, never an identical
 * one, and never awaits: the sync runs on the output path.
 *
 * `confidence` is the tracker's PHASE confidence: it is the axis a coordinator decides on
 * (is `working` believed?) and the only one with an `unknown` before any signal. The attention
 * axis's own confidence stays in the rail; `source` already says what raised the attention.
 */

/**
 * An unchanged `working` is re-sent this often. Main reads a `working` report older than 120 s
 * as stale (ORC18), and a long turn changes no field for minutes while the agent's hooks keep it
 * alive; without a repeat, every turn past two minutes would read as doubtful.
 */
export const WORKING_HEARTBEAT_MS = 45_000;

export interface PaneReportInput {
  readonly paneId: number;
  /** The tracker's snapshot; null for a pane it has never seen. */
  readonly snapshot: PaneAttentionSnapshot | null;
  /** The agent running in the pane right now (not the label an exited agent leaves behind). */
  readonly agent: string | null;
  /** The agent's process id; only meaningful while `agent` is set. */
  readonly pid: number | null;
}

export interface PaneAttentionReporter {
  /** Report what changed since the last call; panes missing from `inputs` are forgotten. */
  sync(inputs: readonly PaneReportInput[]): void;
}

interface Sent {
  readonly report: PaneAttentionReport;
  readonly at: number;
}

function reportOf(input: PaneReportInput): PaneAttentionReport {
  const { snapshot } = input;
  return {
    paneId: input.paneId,
    phase: snapshot?.phase ?? "unknown",
    attention: snapshot?.attention ?? "none",
    source: snapshot?.source ?? null,
    confidence: snapshot?.phaseConfidence ?? "unknown",
    agent: input.agent,
    pid: input.agent === null ? null : input.pid,
  };
}

function same(a: PaneAttentionReport, b: PaneAttentionReport): boolean {
  return (
    a.phase === b.phase &&
    a.attention === b.attention &&
    a.source === b.source &&
    a.confidence === b.confidence &&
    a.agent === b.agent &&
    a.pid === b.pid
  );
}

export function createPaneAttentionReporter(options: {
  readonly send: (report: PaneAttentionReport) => void;
  readonly now: () => number;
}): PaneAttentionReporter {
  const lastSent = new Map<number, Sent>();
  return {
    sync(inputs) {
      const live = new Set<number>();
      for (const input of inputs) {
        live.add(input.paneId);
        const report = reportOf(input);
        const previous = lastSent.get(input.paneId);
        const at = options.now();
        const unchanged = previous !== undefined && same(previous.report, report);
        const heartbeat =
          unchanged && report.phase === "working" && at - previous.at >= WORKING_HEARTBEAT_MS;
        if (!unchanged || heartbeat) {
          lastSent.set(input.paneId, { report, at });
          options.send(report);
        }
      }
      for (const paneId of [...lastSent.keys()]) {
        if (!live.has(paneId)) lastSent.delete(paneId);
      }
    },
  };
}
