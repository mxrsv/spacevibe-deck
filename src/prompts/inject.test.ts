import { describe, expect, it } from "vitest";
import { capturePromptTarget, submitAllowed } from "./inject";
import { createMemoryPtyClient } from "../terminal/pty-client";
import type { PaneAttentionSnapshot } from "../terminal/agent-attention";
import type { PaneProcessInfo } from "../lib/process-info";

const agentInfo = (patch: Partial<PaneProcessInfo> = {}): PaneProcessInfo => ({
  id: 1,
  cwd: "/repo",
  process: "claude",
  kind: "agent",
  agent: "claude",
  ...patch,
});

const idle = (
  patch: Partial<PaneAttentionSnapshot> = {},
): PaneAttentionSnapshot => ({
  phase: "idle",
  attention: "none",
  source: null,
  confidence: "explicit",
  agentLabel: "claude",
  unread: false,
  changedAt: 0,
  revision: 1,
  ...patch,
});

describe("submitAllowed", () => {
  it("passes when all three gates hold", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle(),
        alive: true,
      }),
    ).toBe(true);
  });

  it("passes on a completed run — the agent is done, not mid-dialog", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle({ attention: "completed" }),
        alive: true,
      }),
    ).toBe(true);
  });

  it("fails gate 1 when the pane is no longer that agent", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo({ kind: "idle-shell", agent: null }),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo({ agent: "codex", process: "codex" }),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: null,
        info: agentInfo(),
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: undefined,
        attention: idle(),
        alive: true,
      }),
    ).toBe(false);
  });

  it("fails gate 2 while working or while attention is latched", () => {
    for (const attention of [
      idle({ phase: "working" }),
      idle({ attention: "requested" }),
      idle({ attention: "warning" }),
      idle({ attention: "error" }),
    ]) {
      expect(
        submitAllowed({
          expectedAgent: "claude",
          info: agentInfo(),
          attention,
          alive: true,
        }),
      ).toBe(false);
    }
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: null,
        alive: true,
      }),
    ).toBe(false);
  });

  it("fails gate 3 when the pane is gone from the layout", () => {
    expect(
      submitAllowed({
        expectedAgent: "claude",
        info: agentInfo(),
        attention: idle(),
        alive: false,
      }),
    ).toBe(false);
  });
});

describe("capturePromptTarget", () => {
  it("snapshots the pane, its agent and its cwd", async () => {
    const pty = createMemoryPtyClient({
      infos: new Map([[7, agentInfo({ id: 7 })]]),
    });
    await expect(capturePromptTarget(7, pty)).resolves.toEqual({
      paneId: 7,
      agent: "claude",
      cwd: "/repo",
    });
  });

  it("reports a bare shell as no agent, not as a missing target", async () => {
    const info = agentInfo({
      id: 8,
      kind: "idle-shell",
      agent: null,
      process: "zsh",
    });
    const pty = createMemoryPtyClient({ infos: new Map([[8, info]]) });
    await expect(capturePromptTarget(8, pty)).resolves.toEqual({
      paneId: 8,
      agent: null,
      cwd: "/repo",
    });
  });

  it("has no target with no active pane", async () => {
    await expect(
      capturePromptTarget(null, createMemoryPtyClient()),
    ).resolves.toBeNull();
  });
});
