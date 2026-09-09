import { describe, expect, it } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { AttentionKind, PaneAttentionSnapshot } from "./agent-attention";
import {
  launchCanRetryPrompt,
  launchClearsDraft,
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
    phaseConfidence: "explicit",
    exitCode: null,
    agentLabel: "claude",
    sessionId: null,
    detail: null,
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

  it("clears the draft only after the task was submitted or no prompt was requested", () => {
    expect(TASK_PROMPT_AUTOSEND).toBe(false);
    expect(launchClearsDraft("started")).toBe(true);
    expect(launchClearsDraft("sent")).toBe(true);
    expect(launchClearsDraft("prompt-pending")).toBe(false);
    expect(launchClearsDraft("prompt-not-sent")).toBe(false);
    expect(launchClearsDraft("prompt-failed")).toBe(false);
    expect(launchClearsDraft("spawn-failed")).toBe(false);
  });

  it("retries only outcomes that prove no prompt was pasted", () => {
    expect(launchCanRetryPrompt("prompt-not-sent")).toBe(true);
    expect(launchCanRetryPrompt("prompt-failed")).toBe(true);
    expect(launchCanRetryPrompt("prompt-pending")).toBe(false);
    expect(launchCanRetryPrompt("started")).toBe(false);
    expect(launchCanRetryPrompt("sent")).toBe(false);
    expect(launchCanRetryPrompt("spawn-failed")).toBe(false);
  });

  it("polls often enough to try many times before it gives up", () => {
    expect(TASK_PROMPT_READY_TIMEOUT_MS / TASK_PROMPT_POLL_MS).toBeGreaterThanOrEqual(10);
  });
});
