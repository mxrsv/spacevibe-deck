import { describe, expect, it } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { AttentionKind, PaneAttentionSnapshot } from "./agent-attention";
import {
  launchSucceeded,
  promptReadyToSend,
  TASK_PROMPT_AUTOSEND,
  TASK_PROMPT_READY_TIMEOUT_MS,
  TASK_PROMPT_POLL_MS,
} from "./task-prompt-send";

function info(overrides: Partial<PaneProcessInfo> = {}): PaneProcessInfo {
  return {
    id: 1,
    cwd: "/repo",
    process: "claude",
    kind: "agent",
    agent: "claude",
    ...overrides,
  };
}

function snapshot(
  phase: PaneAttentionSnapshot["phase"],
  attention: AttentionKind = "none",
): PaneAttentionSnapshot {
  return {
    phase,
    attention,
    source: null,
    confidence: "explicit",
    agentLabel: "claude",
    unread: false,
    hasRun: true,
    changedAt: 0,
    revision: 1,
  };
}

describe("promptReadyToSend", () => {
  it("refuses a pane that is still a bare shell", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info({ kind: "idle-shell", agent: null, process: "zsh" }),
        attention: snapshot("idle"),
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane running a different agent", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info({ agent: "codex", process: "codex" }),
        attention: snapshot("idle"),
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane that is still working", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info(),
        attention: snapshot("working"),
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane with a latched question", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info(),
        attention: snapshot("idle", "requested"),
        alive: true,
      }),
    ).toBe(false);
  });

  it("refuses a pane that has left the layout", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info(),
        attention: snapshot("idle"),
        alive: false,
      }),
    ).toBe(false);
  });

  it("refuses while pty_info has not answered yet", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: undefined,
        attention: snapshot("idle"),
        alive: true,
      }),
    ).toBe(false);
  });

  it("accepts an idle pane running the expected agent", () => {
    expect(
      promptReadyToSend({
        expectedAgent: "claude",
        info: info(),
        attention: snapshot("idle"),
        alive: true,
      }),
    ).toBe(true);
  });

  it("treats a composer-only delivery as success while auto-send is off", () => {
    expect(TASK_PROMPT_AUTOSEND).toBe(false);
    expect(launchSucceeded("prompt-pending")).toBe(true);
    expect(launchSucceeded("started")).toBe(true);
    expect(launchSucceeded("prompt-not-sent")).toBe(false);
    expect(launchSucceeded("prompt-failed")).toBe(false);
    expect(launchSucceeded("spawn-failed")).toBe(false);
  });

  it("polls often enough to try many times before it gives up", () => {
    expect(TASK_PROMPT_READY_TIMEOUT_MS / TASK_PROMPT_POLL_MS).toBeGreaterThanOrEqual(10);
  });
});
