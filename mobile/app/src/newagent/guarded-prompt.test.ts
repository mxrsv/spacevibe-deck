import { describe, expect, it } from "vitest";
import type { TreePane } from "@protocol/tree";
import { screenAsksQuestion } from "@/choices/parse-choices";
import {
  GUARD_START,
  guardBanner,
  guardReduce,
  setPendingPrompt,
  takePendingPrompt,
  type GuardEvent,
  type GuardState,
} from "./guarded-prompt";

const pane = (over: Partial<TreePane>): TreePane => ({
  paneId: 1,
  title: "",
  agent: "claude",
  agentLabel: "Claude Code",
  phase: "working",
  attention: "none",
  attentionSince: null,
  lastLine: "",
  lastOutputAt: null,
  ...over,
});
const run = (events: GuardEvent[]): GuardState => events.reduce(guardReduce, GUARD_START);

const TRUST = [
  "Do you trust the files in this folder?",
  "",
  "❯ 1. Yes, proceed",
  "  2. No, exit",
].join("\n");
const TRUST_NO_LIST =
  "Claude Code may read files in this folder.\nDo you trust the files in this folder?\n";
const IDLE = "╭────────────╮\n│ >          │\n╰────────────╯\n  ? for shortcuts\n";

describe("guarded first prompt", () => {
  it("sends once the agent is idle and the screen asks nothing", () => {
    let s = run([
      { t: "tree", pane: null },
      { t: "tree", pane: pane({ phase: "working" }) },
    ]);
    expect(s.phase).toBe("waiting");
    s = guardReduce(s, { t: "tree", pane: pane({ phase: "idle" }) });
    expect(s.phase).toBe("reading");
    s = guardReduce(s, { t: "screen", text: IDLE });
    expect(s.phase).toBe("sending");
    s = guardReduce(s, { t: "sent", outcome: "sent" });
    expect(s).toEqual({ phase: "sent", outcome: "sent" });
  });

  it("holds the prompt when the idle screen is a question or a numbered list", () => {
    for (const screen of [TRUST, TRUST_NO_LIST]) {
      const s = run([
        { t: "tree", pane: pane({ phase: "idle" }) },
        { t: "screen", text: screen },
      ]);
      expect(s).toEqual({ phase: "held", reason: "question", message: null });
      expect(guardBanner(s, "Claude Code")).toBe(
        "Claude Code asked something first. Answer it, then send your prompt.",
      );
    }
  });

  it("holds the prompt when the screen cannot be read", () => {
    const s = run([{ t: "tree", pane: pane({ phase: "idle" }) }, { t: "screen-failed" }]);
    expect(s).toMatchObject({ phase: "held", reason: "question" });
  });

  it("holds the prompt when the agent never gets ready, and ignores a late idle", () => {
    const s = run([{ t: "tree", pane: pane({ phase: "working" }) }, { t: "timeout" }]);
    expect(s).toMatchObject({ phase: "held", reason: "timeout" });
    expect(guardReduce(s, { t: "tree", pane: pane({ phase: "idle" }) })).toBe(s);
    expect(guardBanner(s, "Codex")).toMatch(/did not get ready in time/);
  });

  it("fails when the agent exits, and does not wait for a shell pane", () => {
    expect(run([{ t: "tree", pane: pane({ phase: "exited" }) }])).toMatchObject({
      phase: "failed",
    });
    expect(run([{ t: "tree", pane: pane({ phase: "idle", agent: null }) }]).phase).toBe("waiting");
  });

  it("keeps the prompt when sending fails", () => {
    const s = run([
      { t: "tree", pane: pane({ phase: "idle" }) },
      { t: "screen", text: IDLE },
      { t: "send-failed", message: "That pane is gone." },
    ]);
    expect(s).toEqual({ phase: "held", reason: "send-failed", message: "That pane is gone." });
    expect(guardBanner(s, "Claude Code")).toMatch(/That pane is gone\. Your prompt is in the box/);
  });

  it("ignores a timeout after sending, and events out of order", () => {
    const sent = run([
      { t: "tree", pane: pane({ phase: "idle" }) },
      { t: "screen", text: IDLE },
      { t: "sent", outcome: "sent" },
    ]);
    expect(guardReduce(sent, { t: "timeout" })).toBe(sent);
    expect(guardReduce(GUARD_START, { t: "screen", text: IDLE })).toBe(GUARD_START);
  });
});

describe("screenAsksQuestion", () => {
  it("is false for an idle input box and plain output, true for questions", () => {
    expect(screenAsksQuestion(IDLE)).toBe(false);
    expect(screenAsksQuestion("Welcome to Claude Code\n")).toBe(false);
    expect(screenAsksQuestion("Allow this edit?\n")).toBe(true);
    expect(screenAsksQuestion("Which test runner should I use?\n  ? for shortcuts")).toBe(true);
  });
});

describe("pending prompt", () => {
  it("is handed over once", () => {
    setPendingPrompt("d", 3, "fix it");
    expect(takePendingPrompt("d", 3)).toBe("fix it");
    expect(takePendingPrompt("d", 3)).toBeNull();
  });
});
