import { describe, expect, it } from "vitest";
import type { TreePane } from "@protocol/tree";
import { markKind, paneName } from "./pane-state";

const base: TreePane = {
  paneId: 1,
  title: "zsh",
  agent: null,
  agentLabel: null,
  phase: "idle",
  attention: "none",
  attentionSince: null,
  lastLine: "",
  lastOutputAt: null,
};

describe("markKind", () => {
  it("lets attention outrank phase", () => {
    expect(markKind({ ...base, phase: "working", attention: "requested" })).toBe("needsYou");
    expect(markKind({ ...base, phase: "working", attention: "error" })).toBe("failed");
    expect(markKind({ ...base, phase: "working" })).toBe("working");
    expect(markKind({ ...base, attention: "completed" })).toBe("done");
    expect(markKind({ ...base, phase: "exited" })).toBe("idle");
  });
  it("names a pane by its agent, else its title", () => {
    expect(paneName({ ...base, agentLabel: "Codex" })).toBe("Codex");
    expect(paneName(base)).toBe("zsh");
    expect(paneName({ ...base, title: "" })).toBe("Terminal");
  });
});
