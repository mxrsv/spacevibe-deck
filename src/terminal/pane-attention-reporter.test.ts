import { describe, expect, it } from "vitest";
import type { PaneAttentionReport } from "../lib/pane-attention-report";
import type { PaneAttentionSnapshot } from "./agent-attention";
import {
  WORKING_HEARTBEAT_MS,
  createPaneAttentionReporter,
  type PaneReportInput,
} from "./pane-attention-reporter";

function snapshot(change: Partial<PaneAttentionSnapshot> = {}): PaneAttentionSnapshot {
  return {
    phase: "idle",
    attention: "none",
    source: null,
    confidence: "explicit",
    phaseConfidence: "explicit",
    exitCode: null,
    agentLabel: "claude",
    sessionId: null,
    detail: null,
    unread: false,
    hasRun: false,
    changedAt: 0,
    revision: 1,
    ...change,
  };
}

function input(change: Partial<PaneReportInput> = {}): PaneReportInput {
  return { paneId: 3, snapshot: snapshot(), agent: "claude", pid: 3000, ...change };
}

function setup() {
  const sent: PaneAttentionReport[] = [];
  let clock = 1_000;
  const reporter = createPaneAttentionReporter({
    send: (report) => sent.push(report),
    now: () => clock,
  });
  return {
    sent,
    reporter,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("pane attention reporter", () => {
  it("reports a pane's first state with the right flat keys", () => {
    const { sent, reporter } = setup();
    reporter.sync([
      input({ snapshot: snapshot({ phase: "working", attention: "requested", source: "hook" }) }),
    ]);
    expect(sent).toEqual([
      {
        paneId: 3,
        phase: "working",
        attention: "requested",
        source: "hook",
        confidence: "explicit",
        agent: "claude",
        pid: 3000,
      },
    ]);
  });

  it("reports the PHASE confidence, not the attention axis's", () => {
    const { sent, reporter } = setup();
    reporter.sync([
      input({ snapshot: snapshot({ confidence: "explicit", phaseConfidence: "inferred" }) }),
    ]);
    expect(sent[0]?.confidence).toBe("inferred");
  });

  it("reports a pane the tracker has never seen as unknown, and a shell pane with no agent or pid", () => {
    const { sent, reporter } = setup();
    reporter.sync([input({ paneId: 4, snapshot: null, agent: null, pid: 77 })]);
    expect(sent).toEqual([
      {
        paneId: 4,
        phase: "unknown",
        attention: "none",
        source: null,
        confidence: "unknown",
        agent: null,
        pid: null,
      },
    ]);
  });

  it("sends nothing for an identical state, however often it is synced", () => {
    const { sent, reporter } = setup();
    reporter.sync([input()]);
    reporter.sync([input()]);
    reporter.sync([input({ snapshot: snapshot({ revision: 9, changedAt: 5, unread: true }) })]);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["phase", { snapshot: snapshot({ phase: "working" }) }],
    ["attention", { snapshot: snapshot({ attention: "completed", source: "hook" }) }],
    ["source", { snapshot: snapshot({ source: "bell" }) }],
    ["confidence", { snapshot: snapshot({ phaseConfidence: "inferred" }) }],
    ["agent", { agent: "codex" }],
    ["pid", { pid: 3001 }],
  ])("sends once when only the %s changes", (_name, change) => {
    const { sent, reporter } = setup();
    reporter.sync([input()]);
    reporter.sync([input(change)]);
    reporter.sync([input(change)]);
    expect(sent).toHaveLength(2);
  });

  it("repeats an unchanged working report once a heartbeat has passed, and no other phase", () => {
    const { sent, reporter, advance } = setup();
    const working = input({ snapshot: snapshot({ phase: "working" }) });
    reporter.sync([working]);
    advance(WORKING_HEARTBEAT_MS - 1);
    reporter.sync([working]);
    expect(sent).toHaveLength(1);
    advance(1);
    reporter.sync([working]);
    expect(sent).toHaveLength(2);
    advance(1);
    reporter.sync([working]);
    expect(sent).toHaveLength(2);

    const { sent: idleSent, reporter: idleReporter, advance: idleAdvance } = setup();
    idleReporter.sync([input()]);
    idleAdvance(WORKING_HEARTBEAT_MS * 10);
    idleReporter.sync([input()]);
    expect(idleSent).toHaveLength(1);
  });

  it("keeps each pane apart, and forgets a closed pane so a new pane with its id reports afresh", () => {
    const { sent, reporter } = setup();
    reporter.sync([input({ paneId: 1 }), input({ paneId: 2 })]);
    reporter.sync([input({ paneId: 1 }), input({ paneId: 2, agent: "codex" })]);
    expect(sent.map((report) => report.paneId)).toEqual([1, 2, 2]);
    reporter.sync([input({ paneId: 2, agent: "codex" })]);
    reporter.sync([input({ paneId: 1 }), input({ paneId: 2, agent: "codex" })]);
    expect(sent.map((report) => report.paneId)).toEqual([1, 2, 2, 1]);
  });

  it("reports an agent that left the pane: agent and pid go to null", () => {
    const { sent, reporter } = setup();
    reporter.sync([input({ snapshot: snapshot({ phase: "working" }) })]);
    reporter.sync([input({ snapshot: snapshot({ phase: "exited" }), agent: null, pid: null })]);
    expect(sent[1]).toMatchObject({ phase: "exited", agent: null, pid: null });
  });
});
