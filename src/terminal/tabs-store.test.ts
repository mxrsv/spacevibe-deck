import { describe, expect, it } from "vitest";
import {
  applyTabOverride,
  IDLE_ATTENTION_SUMMARY,
  type AgentAttentionSummary,
  type TabView,
} from "./tabs-store";
import { isTabDotColor } from "../lib/tab-colors";

const base: TabView = {
  key: 1,
  process: "claude",
  name: null,
  dotColor: null,
  workspacePath: "/Users/k/dev/stackgrid",
  agents: ["claude"],
  agentBusy: true,
  unread: false,
};

const attentionSummary: AgentAttentionSummary = {
  kind: "working",
  actionableCount: 0,
  workingCount: 1,
  unreadCount: 0,
};

const withAttention: TabView = {
  ...base,
  attention: attentionSummary,
};

describe("applyTabOverride", () => {
  it("returns the view unchanged without an override", () => {
    expect(applyTabOverride(base, undefined)).toBe(base);
  });

  it("merges a rename on top of the derived values", () => {
    const merged = applyTabOverride(base, { name: "backend" });
    expect(merged).toEqual({ ...base, name: "backend" });
    expect(base.name).toBeNull(); // no mutation
  });

  it("merges a dot color independently of the name", () => {
    expect(applyTabOverride(base, { dotColor: "red" })).toEqual({
      ...base,
      dotColor: "red",
    });
  });

  it("merges both when both are set", () => {
    expect(applyTabOverride(base, { name: "api", dotColor: "cyan" })).toEqual({
      ...base,
      name: "api",
      dotColor: "cyan",
    });
  });

  it("never touches workspacePath, agents, agentBusy or unread (not user overrides)", () => {
    const merged = applyTabOverride(base, { name: "api", dotColor: "cyan" });
    expect(merged.workspacePath).toBe("/Users/k/dev/stackgrid");
    expect(merged.agents).toBe(base.agents);
    expect(merged.agentBusy).toBe(true);
    expect(merged.unread).toBe(false);
  });

  it("never touches workspacePath, agents, agentBusy, unread or attention summary", () => {
    const merged = applyTabOverride(withAttention, {
      name: "api",
      dotColor: "cyan",
    });
    expect(merged.workspacePath).toBe(withAttention.workspacePath);
    expect(merged.agents).toBe(withAttention.agents);
    expect(merged.agentBusy).toBe(withAttention.agentBusy);
    expect(merged.unread).toBe(withAttention.unread);
    expect(merged.attention).toBe(attentionSummary);
    expect(merged.attention).toEqual(attentionSummary);
  });
});

describe("TabView.attention", () => {
  it("carries the AgentAttentionSummary shape when present", () => {
    expect(withAttention.attention).toEqual({
      kind: "working",
      actionableCount: 0,
      workingCount: 1,
      unreadCount: 0,
    });
  });

  it("falls back to IDLE_ATTENTION_SUMMARY when absent", () => {
    expect(base.attention).toBeUndefined();
    const resolved = base.attention ?? IDLE_ATTENTION_SUMMARY;
    expect(resolved).toEqual({
      kind: "idle",
      actionableCount: 0,
      workingCount: 0,
      unreadCount: 0,
    });
  });
});

describe("isTabDotColor", () => {
  it("accepts every preset token and rejects everything else", () => {
    expect(isTabDotColor("accent")).toBe(true);
    expect(isTabDotColor("magenta")).toBe(true);
    expect(isTabDotColor("hotpink")).toBe(false);
    expect(isTabDotColor(7)).toBe(false);
    expect(isTabDotColor(null)).toBe(false);
  });
});
